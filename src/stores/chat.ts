import { defineStore } from 'pinia';
import { getA2AClient, getApiOrigin } from '../services/a2aClient';
import { useSettingsStore } from './settings';
import {
  fetchConversations as apiFetchConversations,
  fetchConversationMessages,
  deleteConversation as apiDeleteConversation,
  deleteAllConversations as apiDeleteAllConversations,
} from '../services/conversationApi';
import type { ConversationSummary, MessageRecord } from '../services/conversationApi';
import type {
  AgentCard,
  Message,
  MessageSendParams,
  Part,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Task,
} from '@a2a-js/sdk';

// Conversation history types (now backed by backend API)
export interface SavedConversation {
  id: string;
  title: string;
  contextId: string | undefined;
  taskId: string | undefined;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// UI-specific types
export interface FileAttachment {
  name: string;
  mimeType: string;
  uri: string;
}

export interface TerminalAttachment {
  processId: string;
  command: string;
  commandShort: string;
  workingDirectory?: string;
  pty?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: Part[];
  timestamp: Date;
  state?: TaskState;
  isStreaming?: boolean;
  thinkingSteps?: ThinkingStep[];
  artifacts?: ArtifactInfo[];
  fileAttachments?: FileAttachment[];
  terminalAttachments?: TerminalAttachment[];
  tokenUsage?: TokenUsage;
  latency?: LatencyInfo;
  reasoningModelLabel?: string;
  summary?: string;
}

export interface ObservationPart {
  kind: 'text' | 'file' | 'data';
  text?: string;
  data?: Record<string, any>;
  file?: { name?: string; mime_type?: string; uri?: string; bytes?: string };
}

export interface ThinkingStep {
  thought: string;
  action: string;
  actionInput: string;
  observation?: ObservationPart[];
  receivedAt?: number;
  modelLabel?: string | null;
}

export interface ArtifactInfo {
  name: string;
  artifactId: string;
  type: string;
  data: any;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LatencyInfo {
  requestSentAt: number;
  firstEventAt?: number;
  firstStepAt?: number;
  firstTokenAt?: number;
  completedAt?: number;
}

interface ChatState {
  messages: ChatMessage[];
  currentTaskId: string | undefined;
  currentContextId: string | undefined;
  agentCard: AgentCard | null;
  agentName: string;
  isConnected: boolean;
  isStreaming: boolean;
  isSummarizing: boolean;
  error: string | null;
  conversations: SavedConversation[];
  activeConversationId: string | null;
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    messages: [],
    currentTaskId: undefined,
    currentContextId: undefined,
    agentCard: null,
    agentName: 'Agent',
    isConnected: false,
    isStreaming: false,
    isSummarizing: false,
    error: null,
    conversations: [],
    activeConversationId: null,
  }),

  actions: {
    /**
     * Fetch agent card to get agent info and verify connectivity
     */
    async fetchAgentCard() {
      try {
        this.error = null;
        const client = await getA2AClient();
        this.agentCard = await client.getAgentCard();
        this.agentName = this.agentCard.name || 'Agent';
        this.isConnected = true;
        console.log('✓ Connected to agent:', this.agentName);
      } catch (error: any) {
        this.isConnected = false;
        this.error = error.message || 'Failed to connect to agent';
        console.error('Failed to fetch agent card:', error);
        throw error;
      }
    },

    /**
     * Send a message to the agent and process streaming responses
     */
    async sendMessage(text: string, options?: { reasoning?: boolean }) {
      if (!text.trim()) return;

      this.isStreaming = true;
      this.error = null;

      // Add user message to UI
      const userMessage: ChatMessage = {
        id: this.generateId(),
        role: 'user',
        content: text,
        parts: [{ kind: 'text', text } as Part],
        timestamp: new Date(),
      };
      this.messages.push(userMessage);

      // Create assistant message placeholder (will be updated as we stream)
      const requestSentAt = Date.now();
      const assistantMessageRaw: ChatMessage = {
        id: this.generateId(),
        role: 'assistant',
        content: '',
        parts: [],
        timestamp: new Date(),
        isStreaming: true,
        thinkingSteps: [],
        artifacts: [],
        latency: { requestSentAt },
      };
      this.messages.push(assistantMessageRaw);

      // Get the reactive proxy reference from the store so Vue detects mutations
      const assistantMessage = this.messages[this.messages.length - 1];

      // Track timing milestones
      let hasReceivedFirstEvent = false;

      try {
        // Construct message payload
        const messagePayload: Message = {
          messageId: this.generateId(),
          kind: 'message',
          role: 'user',
          parts: [{ kind: 'text', text } as Part],
        };

        // Add taskId and contextId if available
        if (this.currentTaskId) {
          messagePayload.taskId = this.currentTaskId;
        }
        if (this.currentContextId) {
          messagePayload.contextId = this.currentContextId;
        }

        const params: MessageSendParams = {
          message: messagePayload,
          metadata: {
            reasoning: options?.reasoning !== false,
          },
        };

        // Accumulate text tokens for display (token-by-token streaming)
        let currentTextPart = '';

        // Stream responses with retry (once) on error
        const client = await getA2AClient();
        console.log('Sending message with payload:', params);

        let retried = false;
        while (true) {
          try {
            for await (const event of client.sendMessageStream(params)) {
              // Capture first event latency
              if (!hasReceivedFirstEvent && assistantMessage.latency) {
                assistantMessage.latency.firstEventAt = Date.now();
                hasReceivedFirstEvent = true;
              }

              // Log only non-artifact events to reduce overhead during token streaming
              if (event.kind !== 'artifact-update') {
                console.log('Stream event:', event);
              }

              if (event.kind === 'status-update') {
                this.handleStatusUpdate(event, assistantMessage);
              } else if (event.kind === 'artifact-update') {
                // Handle token-by-token text streaming from artifacts
                const updatedText = this.handleArtifactUpdate(event, assistantMessage, currentTextPart);
                if (updatedText !== undefined) {
                  currentTextPart = updatedText;
                }
              } else if (event.kind === 'message') {
                this.handleMessageEvent(event as Message, assistantMessage);
              } else if (event.kind === 'task') {
                this.handleTaskEvent(event as Task, assistantMessage);
              }
            }
            break; // Stream completed successfully
          } catch (streamError: any) {
            if (retried) {
              throw streamError; // Already retried once, propagate to outer catch
            }
            console.warn('Stream error, retrying with cleared context:', streamError);
            retried = true;

            // Clear current context and task ID
            this.currentContextId = undefined;
            this.currentTaskId = undefined;
            delete messagePayload.contextId;
            delete messagePayload.taskId;

            // Reset streaming state for retry
            currentTextPart = '';
            hasReceivedFirstEvent = false;
            assistantMessage.content = '';
            assistantMessage.thinkingSteps = [];
            assistantMessage.artifacts = [];
            assistantMessage.latency = { requestSentAt: Date.now() };
          }
        }

        // Capture completion latency
        if (assistantMessage.latency) {
          assistantMessage.latency.completedAt = Date.now();
        }

        // Finalize message
        assistantMessage.isStreaming = false;

        // Refresh conversation list from backend
        await this.loadConversations();

        // After sending first message in a new chat, activate the newly created conversation
        if (!this.activeConversationId && this.currentContextId) {
          const newConv = this.conversations.find(c => c.contextId === this.currentContextId);
          if (newConv) {
            this.activeConversationId = newConv.id;
          }
        }

      } catch (error: any) {
        this.error = error.message || 'Failed to send message';
        assistantMessage.content = `Error: ${this.error}`;
        assistantMessage.isStreaming = false;
        console.error('Error sending message:', error);
      } finally {
        this.isStreaming = false;
        this.isSummarizing = false;
      }
    },

    /**
     * Stop the in-flight conversation. Tells the backend to cancel the
     * running task; flips the UI optimistically so the button morphs back
     * instantly. The streaming for-await loop in sendMessage() will exit
     * naturally as the backend closes the stream.
     */
    async stopMessage() {
      const taskId = this.currentTaskId;
      // Optimistic UI flip — even if the network call fails, the user sees
      // the button revert immediately.
      this.isStreaming = false;
      this.isSummarizing = false;
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'assistant') {
        last.isStreaming = false;
      }

      if (!taskId) {
        // Stop pressed before the first stream event registered a task id.
        return;
      }

      try {
        const token = useSettingsStore().authToken;
        await fetch(`${getApiOrigin()}/api/tasks/${encodeURIComponent(taskId)}/cancel`, {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });
      } catch (e) {
        console.warn('Cancel request failed', e);
      }
    },

    /**
     * Handle status update events
     */
    handleStatusUpdate(event: TaskStatusUpdateEvent, message: ChatMessage) {
      message.state = event.status.state;

      // Update task/context IDs
      if (event.taskId) {
        this.currentTaskId = event.taskId;
      }
      if (event.contextId) {
        this.currentContextId = event.contextId;
      }

      // Only extract text from status message if we don't already have
      // content from artifact streaming (to avoid duplication)
      if (event.status.message && !message.content) {
        this.extractTextFromParts(event.status.message.parts, message);
      }

      // Clear task ID if final and not waiting for input
      if (event.final && event.status.state !== 'input-required') {
        console.log('Task completed, clearing task ID');
        this.currentTaskId = undefined;
      }
    },

    /**
     * Handle artifact update events (thinking, result, token_usage, text tokens)
     * Optimized for token-by-token streaming from "Text Response" artifacts
     */
    handleArtifactUpdate(
      event: TaskArtifactUpdateEvent, 
      message: ChatMessage, 
      currentTextPart: string
    ): string | undefined {
      // Update task/context IDs
      if (event.taskId) {
        this.currentTaskId = event.taskId;
      }
      if (event.contextId) {
        this.currentContextId = event.contextId;
      }

      const artifact = event.artifact;
      if (!artifact || !artifact.parts) {
        return undefined;
      }

      // Special handling for authentication token artifacts
      if (artifact.name === 'token') {
        this.handleTokenArtifact(artifact.parts);
        return undefined;
      }

      // Track if we found any content in this artifact
      let foundContent = false;

      for (const part of artifact.parts) {
        // Handle text parts - optimized for token-by-token streaming
        if ('text' in part && typeof part.text === 'string') {
          // Token-by-token streaming from "Text Response" artifact
          if (artifact.name === 'Text Response' || event.append) {
            // Append mode: accumulate tokens as they arrive
            currentTextPart += part.text;
            
            // Capture first token latency
            if (message.latency && !message.latency.firstTokenAt && part.text.length > 0) {
              message.latency.firstTokenAt = Date.now();
            }
          } else {
            // Replace mode: set as new text (rarely used for streaming)
            currentTextPart = part.text;
          }
          
          // Update message content reactively for Vue
          message.content = this.buildMessageContent(message, currentTextPart);
          foundContent = true;
        }

        // Handle file parts (file artifacts from system_file tool)
        if ('file' in part && typeof part.file === 'object' && part.file) {
          const fileObj = part.file as any;
          const attachment: FileAttachment = {
            name: fileObj.name || 'file',
            mimeType: fileObj.mimeType || fileObj.mime_type || 'application/octet-stream',
            uri: fileObj.uri || '',
          };
          message.fileAttachments = message.fileAttachments || [];
          message.fileAttachments.push(attachment);
          message.content = this.buildMessageContent(message, currentTextPart);
          foundContent = true;
        }

        // Handle data parts (thinking, result, token_usage)
        if ('data' in part && typeof part.data === 'object') {
          const data = part.data as any;

          if (artifact.name === 'thinking') {
            // Thinking artifact: { Thought, Action, Action_Input, Model_Label, Reasoning_Model_Label }
            const stepReceivedAt = Date.now();
            const thinkingStep: ThinkingStep = {
              thought: data.Thought || '',
              action: data.Action || '',
              actionInput: data.Action_Input || '',
              receivedAt: stepReceivedAt,
              modelLabel: data.Model_Label || null,
            };
            message.thinkingSteps = message.thinkingSteps || [];
            message.thinkingSteps.push(thinkingStep);

            // Set reasoning model label from first thinking artifact
            if (!message.reasoningModelLabel && data.Reasoning_Model_Label) {
              message.reasoningModelLabel = data.Reasoning_Model_Label;
            }

            // Capture first step latency
            if (message.latency && !message.latency.firstStepAt) {
              message.latency.firstStepAt = stepReceivedAt;
            }
            
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'result') {
            // Result artifact: attach observation parts (list[Part]) to the latest thinking step
            const observationParts: ObservationPart[] = Array.isArray(data.Observation)
              ? data.Observation
              : [{ kind: 'text', text: typeof data.Observation === 'string' ? data.Observation : JSON.stringify(data.Observation) }];
            if (message.thinkingSteps && message.thinkingSteps.length > 0) {
              // Find the latest thinking step without an observation
              const unresolvedStep = [...message.thinkingSteps]
                .reverse()
                .find(s => !s.observation);
              if (unresolvedStep) {
                unresolvedStep.observation = observationParts;
              }
            }
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'token_usage' && 'token_usage' in data) {
            // Token usage artifact
            const usage = data.token_usage;
            message.tokenUsage = {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            };
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'summary' && typeof data.summary === 'string') {
            // Reasoning summary artifact (emitted after the Final Answer Tool)
            message.summary = data.summary;
            // Summary arrived; clear the summarizing indicator.
            this.isSummarizing = false;
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'phase' && typeof data.phase === 'string') {
            // Phase signal used to swap the streaming indicator label
            // ("Agent is thinking..." → "Agent is summarizing...").
            console.log('[indicator] phase artifact received:', data.phase);
            this.isSummarizing = data.phase === 'summarizing';
            foundContent = true;
          } else if (artifact.name === 'terminal' && typeof data.process_id === 'string') {
            const attachment: TerminalAttachment = {
              processId: data.process_id,
              command: data.command || '',
              commandShort: data.command_short || data.command || '',
              workingDirectory: data.working_directory || '',
              pty: Boolean(data.pty),
            };
            message.terminalAttachments = message.terminalAttachments || [];
            if (!message.terminalAttachments.some(t => t.processId === attachment.processId)) {
              message.terminalAttachments.push(attachment);
            }
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else {
            console.log('[indicator] generic data artifact:', { name: artifact.name, data });
            // Generic data artifact
            const artifactInfo: ArtifactInfo = {
              name: artifact.name || 'unknown',
              artifactId: artifact.artifactId || this.generateId(),
              type: 'data',
              data,
            };
            message.artifacts = message.artifacts || [];
            message.artifacts.push(artifactInfo);
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          }
        }
      }

      // Return updated text content if we found any
      return foundContent ? currentTextPart : undefined;
    },

    /**
     * Handle token artifacts (save to localStorage)
     */
    handleTokenArtifact(parts: Part[]) {
      for (const part of parts) {
        if ('text' in part && typeof part.text === 'string') {
          const token = part.text;
          try {
            // Save token to localStorage (similar to client_host.py storage)
            localStorage.setItem(`a2a_agent_token_${this.agentName}`, token);
            console.log(`Token saved for agent: ${this.agentName}`);
          } catch (e) {
            console.error('Failed to save token:', e);
          }
        }
      }
    },

    /**
     * Handle message events from stream
     */
    handleMessageEvent(event: Message, message: ChatMessage) {
      if (event.taskId) {
        this.currentTaskId = event.taskId;
      }
      if (event.contextId) {
        this.currentContextId = event.contextId;
      }

      this.extractTextFromParts(event.parts, message);
    },

    /**
     * Handle task events from stream
     */
    handleTaskEvent(event: Task, message: ChatMessage) {
      if (event.id) {
        this.currentTaskId = event.id;
      }
      if (event.contextId) {
        this.currentContextId = event.contextId;
      }

      message.state = event.status.state;

      if (event.status.message) {
        this.extractTextFromParts(event.status.message.parts, message);
      }
    },

    /**
     * Extract text from parts and update message
     */
    extractTextFromParts(parts: Part[], message: ChatMessage) {
      for (const part of parts) {
        if ('text' in part && typeof part.text === 'string') {
          message.content += (message.content ? '\n' : '') + part.text;
        }
      }
    },

    /**
     * Build complete message content from all parts
     * Combines streaming text tokens with thinking steps and results
     */
    buildMessageContent(_message: ChatMessage, currentTextPart: string): string {
      // Only return the accumulated text response.
      // Thinking steps and results are displayed separately via the timeline component.
      return currentTextPart;
    },

    /**
     * Connect to the agent and load conversations
     */
    async connect() {
      await this.fetchAgentCard();
      await this.loadConversations();
    },

    /**
     * Disconnect from the agent
     */
    disconnect() {
      this.isConnected = false;
      this.agentCard = null;
      this.agentName = 'Agent';
      this.error = null;
      console.log('Disconnected from agent');
    },

    /**
     * Reset all chat state for a profile switch, then reconnect.
     */
    async resetForProfileSwitch() {
      this.messages = [];
      this.currentTaskId = undefined;
      this.currentContextId = undefined;
      this.activeConversationId = null;
      this.conversations = [];
      this.error = null;
      this.isStreaming = false;

      if (this.isConnected) {
        this.disconnect();
      }

      try {
        await this.connect();
      } catch (e) {
        console.error('Failed to reconnect after profile switch:', e);
      }
    },

    /**
     * Load conversations from backend API
     */
    async loadConversations() {
      try {
        const settingsStore = useSettingsStore();
        const agentUrl = settingsStore.agentUrl;
        const authToken = settingsStore.authToken;
        const profile = settingsStore.profileId;
        if (!profile) return;

        const conversations = await apiFetchConversations(agentUrl, authToken, profile);
        this.conversations = conversations.map(c => ({
          id: c.id,
          title: c.title,
          contextId: c.context_id ?? undefined,
          taskId: c.task_id ?? undefined,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          messageCount: c.message_count,
        }));
      } catch (e) {
        console.error('Failed to load conversations:', e);
      }
    },

    /**
     * Switch to a saved conversation (loads messages from backend)
     */
    async switchConversation(id: string) {
      if (id === this.activeConversationId) return;

      try {
        const settingsStore = useSettingsStore();
        const agentUrl = settingsStore.agentUrl;
        const authToken = settingsStore.authToken;

        const { conversation, messages } = await fetchConversationMessages(agentUrl, authToken, id);

        this.messages = messages.map(this.mapBackendMessage);
        this.currentTaskId = conversation.task_id ?? undefined;
        this.currentContextId = conversation.context_id ?? undefined;
        this.activeConversationId = id;
        this.error = null;
      } catch (e) {
        console.error('Failed to switch conversation:', e);
      }
    },

    /**
     * Map a backend MessageRecord to a frontend ChatMessage
     */
    mapBackendMessage(msg: MessageRecord): ChatMessage {
      const thinkingSteps: ThinkingStep[] | undefined = msg.thinking_steps
        ? msg.thinking_steps.map(s => ({
            thought: s.thought,
            action: s.action,
            actionInput: s.action_input,
            observation: s.observation,
            modelLabel: s.model_label || null,
          }))
        : undefined;

      // Derive reasoning model label from first step that has it
      const reasoningModelLabel = msg.thinking_steps
        ?.find(s => s.reasoning_model_label)?.reasoning_model_label ?? undefined;

      const tokenUsage: TokenUsage | undefined = msg.token_usage
        ? {
            inputTokens: msg.token_usage.input_tokens,
            outputTokens: msg.token_usage.output_tokens,
            totalTokens: (msg.token_usage.input_tokens || 0) + (msg.token_usage.output_tokens || 0),
          }
        : undefined;

      // Extract file attachments from persisted parts (only FileParts are stored)
      const fileAttachments: FileAttachment[] | undefined = msg.parts
        ? msg.parts
            .filter((p: any) => p.kind === 'file' && p.file)
            .map((p: any) => ({
              name: p.file.name || p.file.Name || 'file',
              mimeType: p.file.mimeType || p.file.mime_type || 'application/octet-stream',
              uri: p.file.uri || p.file.Uri || '',
            }))
        : undefined;

      // Extract terminal attachments persisted as DataParts with the terminal shape
      const terminalAttachments: TerminalAttachment[] | undefined = msg.parts
        ? msg.parts
            .filter((p: any) => p.kind === 'data' && p.data && typeof p.data.process_id === 'string')
            .map((p: any) => ({
              processId: p.data.process_id,
              command: p.data.command || '',
              commandShort: p.data.command_short || p.data.command || '',
              workingDirectory: p.data.working_directory || '',
              pty: Boolean(p.data.pty),
            }))
        : undefined;

      return {
        id: msg.id,
        role: msg.role === 'agent' ? 'assistant' : 'user',
        content: msg.content || '',
        parts: msg.parts || [],
        timestamp: new Date(msg.created_at),
        isStreaming: false,
        thinkingSteps,
        tokenUsage,
        fileAttachments: fileAttachments && fileAttachments.length > 0 ? fileAttachments : undefined,
        terminalAttachments: terminalAttachments && terminalAttachments.length > 0 ? terminalAttachments : undefined,
        reasoningModelLabel,
        summary: msg.summary ?? undefined,
      };
    },

    /**
     * Switch to a new (empty) current chat
     */
    switchToNewChat() {
      if (this.activeConversationId === null && this.messages.length === 0) return;

      this.messages = [];
      this.currentTaskId = undefined;
      this.currentContextId = undefined;
      this.activeConversationId = null;
      this.error = null;
    },

    /**
     * Clear conversation and reset state (New Chat button)
     */
    clearConversation() {
      console.log('Clearing conversation');
      this.messages = [];
      this.currentTaskId = undefined;
      this.currentContextId = undefined;
      this.activeConversationId = null;
      this.error = null;
    },

    /**
     * Delete a single saved conversation (from backend)
     */
    async deleteConversation(id: string) {
      try {
        const settingsStore = useSettingsStore();
        await apiDeleteConversation(settingsStore.agentUrl, settingsStore.authToken, id);
      } catch (e) {
        console.error('Failed to delete conversation:', e);
      }
      this.conversations = this.conversations.filter(c => c.id !== id);
      if (this.activeConversationId === id) {
        this.messages = [];
        this.currentTaskId = undefined;
        this.currentContextId = undefined;
        this.activeConversationId = null;
      }
    },

    /**
     * Clear all saved conversations (from backend)
     */
    async clearAllConversations() {
      try {
        const settingsStore = useSettingsStore();
        const profile = settingsStore.profileId;
        if (profile) {
          await apiDeleteAllConversations(settingsStore.agentUrl, settingsStore.authToken, profile);
        }
      } catch (e) {
        console.error('Failed to clear conversations:', e);
      }
      this.conversations = [];
      this.activeConversationId = null;
      this.messages = [];
      this.currentTaskId = undefined;
      this.currentContextId = undefined;
      this.error = null;
    },

    /**
     * Generate a unique ID
     */
    generateId(): string {
      return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },
  },
});
