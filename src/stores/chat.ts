import { defineStore } from 'pinia';
import { getA2AClient, getApiOrigin } from '../services/a2aClient';
import { useSettingsStore } from './settings';
import { useNotificationsStore } from './notifications';
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

// Sentinel key for the empty "new chat" landing slot before a temp id is allocated.
export const NEW_CHAT_KEY = '__new__';

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

export interface ConversationRuntime {
  isStreaming: boolean;
  isSummarizing: boolean;
  currentTaskId: string | undefined;
  currentContextId: string | undefined;
  startedAt: number;
}

interface ChatState {
  messagesByConversation: Record<string, ChatMessage[]>;
  runtimes: Record<string, ConversationRuntime>;
  agentCard: AgentCard | null;
  agentName: string;
  isConnected: boolean;
  error: string | null;
  conversations: SavedConversation[];
  activeConversationId: string | null;
}

function makeRuntime(): ConversationRuntime {
  return {
    isStreaming: false,
    isSummarizing: false,
    currentTaskId: undefined,
    currentContextId: undefined,
    startedAt: Date.now(),
  };
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    messagesByConversation: {},
    runtimes: {},
    agentCard: null,
    agentName: 'Agent',
    isConnected: false,
    error: null,
    conversations: [],
    activeConversationId: null,
  }),

  getters: {
    activeKey(state): string {
      return state.activeConversationId ?? NEW_CHAT_KEY;
    },
    messages(state): ChatMessage[] {
      const key = state.activeConversationId ?? NEW_CHAT_KEY;
      return state.messagesByConversation[key] ?? [];
    },
    activeRuntime(state): ConversationRuntime | undefined {
      const key = state.activeConversationId ?? NEW_CHAT_KEY;
      return state.runtimes[key];
    },
    isStreaming(state): boolean {
      const key = state.activeConversationId ?? NEW_CHAT_KEY;
      return !!state.runtimes[key]?.isStreaming;
    },
    isSummarizing(state): boolean {
      const key = state.activeConversationId ?? NEW_CHAT_KEY;
      return !!state.runtimes[key]?.isSummarizing;
    },
    /**
     * Map of conversationId -> isStreaming, used by the sidebar to show
     * a "live" indicator on background-running conversations.
     */
    streamingConversationIds(state): Set<string> {
      const ids = new Set<string>();
      for (const [id, rt] of Object.entries(state.runtimes)) {
        if (rt.isStreaming) ids.add(id);
      }
      return ids;
    },
  },

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
     * Ensure a bucket and runtime exist for the given conversation key.
     */
    ensureBucket(key: string): { bucket: ChatMessage[]; runtime: ConversationRuntime } {
      if (!this.messagesByConversation[key]) {
        this.messagesByConversation[key] = [];
      }
      if (!this.runtimes[key]) {
        this.runtimes[key] = makeRuntime();
      }
      return {
        bucket: this.messagesByConversation[key],
        runtime: this.runtimes[key],
      };
    },

    /**
     * Send a message to the agent and process streaming responses.
     * Each conversation runs independently — switching to another conversation
     * does NOT pause or block this stream. Events route to the correct
     * conversation via the closure-captured `cid` and `bucket` references.
     */
    async sendMessage(text: string, options?: { reasoning?: boolean; conversationId?: string }) {
      if (!text.trim()) return;

      this.error = null;

      // Resolve which conversation this send belongs to.
      // Precedence: explicit override → active conversation → new temp id.
      let cid: string =
        options?.conversationId
        ?? this.activeConversationId
        ?? `temp-${this.generateId()}`;

      // If we allocated a brand-new temp id and there's no active conversation,
      // make this temp the active one so the user sees their message immediately.
      const allocatedTemp = !options?.conversationId && !this.activeConversationId;
      if (allocatedTemp) {
        this.activeConversationId = cid;
      }

      // Capture closure references — these survive any future activeConversationId
      // changes or temp→real migrations (we update `cid` below when migrating).
      const { bucket, runtime } = this.ensureBucket(cid);

      runtime.isStreaming = true;
      runtime.isSummarizing = false;
      runtime.startedAt = Date.now();

      // Add user message to UI
      const userMessage: ChatMessage = {
        id: this.generateId(),
        role: 'user',
        content: text,
        parts: [{ kind: 'text', text } as Part],
        timestamp: new Date(),
      };
      bucket.push(userMessage);

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
      bucket.push(assistantMessageRaw);

      // Get the reactive proxy reference so Vue detects mutations
      const assistantMessage = bucket[bucket.length - 1];

      // Track timing milestones
      let hasReceivedFirstEvent = false;
      let errored = false;

      try {
        // Construct message payload
        const messagePayload: Message = {
          messageId: this.generateId(),
          kind: 'message',
          role: 'user',
          parts: [{ kind: 'text', text } as Part],
        };

        // Add taskId and contextId if available for this conversation's runtime.
        // For temp ids, contextId is initially undefined — backend assigns one.
        if (runtime.currentTaskId) {
          messagePayload.taskId = runtime.currentTaskId;
        }
        if (runtime.currentContextId) {
          messagePayload.contextId = runtime.currentContextId;
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

              // Temp-id migration: as soon as the backend reveals a real
              // contextId on this stream, swap our bucket key from `temp-…`
              // to the real conversation id. The bucket array reference is
              // preserved, so handlers keep mutating the right messages.
              const eventContextId =
                (event as any).contextId
                ?? ((event as any).status?.contextId)
                ?? undefined;
              if (cid.startsWith('temp-') && eventContextId && typeof eventContextId === 'string') {
                const realId = await this.migrateTempToReal(cid, eventContextId);
                if (realId) cid = realId;
              }

              if (event.kind === 'status-update') {
                this.handleStatusUpdate(event, assistantMessage, runtime);
              } else if (event.kind === 'artifact-update') {
                const updatedText = this.handleArtifactUpdate(event, assistantMessage, runtime, currentTextPart);
                if (updatedText !== undefined) {
                  currentTextPart = updatedText;
                }
              } else if (event.kind === 'message') {
                this.handleMessageEvent(event as Message, assistantMessage, runtime);
              } else if (event.kind === 'task') {
                this.handleTaskEvent(event as Task, assistantMessage, runtime);
              }
            }
            break; // Stream completed successfully
          } catch (streamError: any) {
            if (retried) {
              throw streamError;
            }
            console.warn('Stream error, retrying with cleared context:', streamError);
            retried = true;

            // Clear this conversation's context/task and retry once
            runtime.currentContextId = undefined;
            runtime.currentTaskId = undefined;
            delete messagePayload.contextId;
            delete messagePayload.taskId;

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

        // Refresh conversation list so a brand-new conversation appears in the sidebar
        // even if the temp→real migration didn't already trigger a fetch.
        await this.loadConversations();

      } catch (error: any) {
        errored = true;
        this.error = error.message || 'Failed to send message';
        assistantMessage.content = `Error: ${this.error}`;
        assistantMessage.isStreaming = false;
        console.error('Error sending message:', error);
      } finally {
        runtime.isStreaming = false;
        runtime.isSummarizing = false;

        // Push a notification if this conversation isn't the one the user is looking at.
        if (cid !== this.activeConversationId) {
          this.pushCompletionNotification(cid, assistantMessage, errored);
        }
      }
    },

    /**
     * Look up the real conversation row matching `realContextId` and migrate
     * the temp bucket / runtime under the real conversation id key. Returns
     * the new key (real conversationId) on success, or undefined if the
     * conversation row hasn't appeared yet.
     */
    async migrateTempToReal(tempId: string, realContextId: string): Promise<string | undefined> {
      // Reload conversations to find the new row.
      await this.loadConversations();
      const conv = this.conversations.find(c => c.contextId === realContextId);
      if (!conv) {
        // Backend hasn't persisted it yet — leave as temp; we'll try again
        // on the next event with a contextId.
        return undefined;
      }
      const realId = conv.id;
      if (realId === tempId) return realId;
      if (this.messagesByConversation[realId]) {
        // A bucket already exists under realId (unlikely). Merge by appending.
        const tempBucket = this.messagesByConversation[tempId];
        if (tempBucket) {
          this.messagesByConversation[realId].push(...tempBucket);
        }
      } else {
        this.messagesByConversation[realId] = this.messagesByConversation[tempId];
      }
      if (!this.runtimes[realId]) {
        this.runtimes[realId] = this.runtimes[tempId];
      }
      delete this.messagesByConversation[tempId];
      delete this.runtimes[tempId];
      if (this.activeConversationId === tempId) {
        this.activeConversationId = realId;
      }
      return realId;
    },

    /**
     * Push a notification entry for a non-active conversation that just
     * finished (or errored). Uses the conversation's title from the saved
     * list; falls back to a generic label for unmigrated temp ids.
     */
    pushCompletionNotification(conversationId: string, assistantMessage: ChatMessage, errored: boolean) {
      const settings = useSettingsStore();
      const profile = settings.profileId;
      if (!profile) return;
      const conv = this.conversations.find(c => c.id === conversationId);
      const title = conv?.title ?? 'New conversation';
      const previewSource = errored
        ? assistantMessage.content
        : (assistantMessage.content || '(empty response)');
      const preview = previewSource.slice(0, 80);
      try {
        useNotificationsStore().push(profile, {
          id: this.generateId(),
          conversationId,
          conversationTitle: title,
          messagePreview: preview,
          kind: errored ? 'error' : 'completed',
          createdAt: Date.now(),
          seen: false,
        });
      } catch (e) {
        console.warn('Failed to push notification:', e);
      }
    },

    /**
     * Stop the in-flight conversation. Tells the backend to cancel the
     * running task; flips the UI optimistically so the button morphs back
     * instantly. Defaults to the active conversation; pass `conversationId`
     * to stop a specific background stream.
     */
    async stopMessage(conversationId?: string) {
      const cid = conversationId ?? this.activeConversationId ?? NEW_CHAT_KEY;
      const runtime = this.runtimes[cid];
      const bucket = this.messagesByConversation[cid];
      if (!runtime) return;

      const taskId = runtime.currentTaskId;
      runtime.isStreaming = false;
      runtime.isSummarizing = false;
      const last = bucket?.[bucket.length - 1];
      if (last?.role === 'assistant') {
        last.isStreaming = false;
      }

      if (!taskId) {
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
    handleStatusUpdate(event: TaskStatusUpdateEvent, message: ChatMessage, runtime: ConversationRuntime) {
      message.state = event.status.state;

      if (event.taskId) {
        runtime.currentTaskId = event.taskId;
      }
      if (event.contextId) {
        runtime.currentContextId = event.contextId;
      }

      // Only extract text from status message if we don't already have
      // content from artifact streaming (to avoid duplication)
      if (event.status.message && !message.content) {
        this.extractTextFromParts(event.status.message.parts, message);
      }

      // Clear task ID if final and not waiting for input
      if (event.final && event.status.state !== 'input-required') {
        console.log('Task completed, clearing task ID');
        runtime.currentTaskId = undefined;
      }
    },

    /**
     * Handle artifact update events (thinking, result, token_usage, text tokens)
     * Optimized for token-by-token streaming from "Text Response" artifacts
     */
    handleArtifactUpdate(
      event: TaskArtifactUpdateEvent,
      message: ChatMessage,
      runtime: ConversationRuntime,
      currentTextPart: string
    ): string | undefined {
      if (event.taskId) {
        runtime.currentTaskId = event.taskId;
      }
      if (event.contextId) {
        runtime.currentContextId = event.contextId;
      }

      const artifact = event.artifact;
      if (!artifact || !artifact.parts) {
        return undefined;
      }

      if (artifact.name === 'token') {
        this.handleTokenArtifact(artifact.parts);
        return undefined;
      }

      let foundContent = false;

      for (const part of artifact.parts) {
        if ('text' in part && typeof part.text === 'string') {
          if (artifact.name === 'Text Response' || event.append) {
            currentTextPart += part.text;

            if (message.latency && !message.latency.firstTokenAt && part.text.length > 0) {
              message.latency.firstTokenAt = Date.now();
            }
          } else {
            currentTextPart = part.text;
          }

          message.content = this.buildMessageContent(message, currentTextPart);
          foundContent = true;
        }

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

        if ('data' in part && typeof part.data === 'object') {
          const data = part.data as any;

          if (artifact.name === 'thinking') {
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

            if (!message.reasoningModelLabel && data.Reasoning_Model_Label) {
              message.reasoningModelLabel = data.Reasoning_Model_Label;
            }

            if (message.latency && !message.latency.firstStepAt) {
              message.latency.firstStepAt = stepReceivedAt;
            }

            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'result') {
            const observationParts: ObservationPart[] = Array.isArray(data.Observation)
              ? data.Observation
              : [{ kind: 'text', text: typeof data.Observation === 'string' ? data.Observation : JSON.stringify(data.Observation) }];
            if (message.thinkingSteps && message.thinkingSteps.length > 0) {
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
            const usage = data.token_usage;
            message.tokenUsage = {
              inputTokens: usage.input_tokens || 0,
              outputTokens: usage.output_tokens || 0,
              totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
            };
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'summary' && typeof data.summary === 'string') {
            message.summary = data.summary;
            runtime.isSummarizing = false;
            message.content = this.buildMessageContent(message, currentTextPart);
            foundContent = true;
          } else if (artifact.name === 'phase' && typeof data.phase === 'string') {
            console.log('[indicator] phase artifact received:', data.phase);
            runtime.isSummarizing = data.phase === 'summarizing';
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
    handleMessageEvent(event: Message, message: ChatMessage, runtime: ConversationRuntime) {
      if (event.taskId) {
        runtime.currentTaskId = event.taskId;
      }
      if (event.contextId) {
        runtime.currentContextId = event.contextId;
      }

      this.extractTextFromParts(event.parts, message);
    },

    /**
     * Handle task events from stream
     */
    handleTaskEvent(event: Task, message: ChatMessage, runtime: ConversationRuntime) {
      if (event.id) {
        runtime.currentTaskId = event.id;
      }
      if (event.contextId) {
        runtime.currentContextId = event.contextId;
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
     * Cancels every in-flight stream first.
     */
    async resetForProfileSwitch() {
      for (const id of Object.keys(this.runtimes)) {
        if (this.runtimes[id].isStreaming) {
          await this.stopMessage(id);
        }
      }
      this.messagesByConversation = {};
      this.runtimes = {};
      this.activeConversationId = null;
      this.conversations = [];
      this.error = null;

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
     * Switch to a saved conversation. If we already have an in-flight
     * stream for it (or in-memory messages), keep them — otherwise fetch
     * from the backend.
     */
    async switchConversation(id: string) {
      if (id === this.activeConversationId) return;

      const hasBucket = !!this.messagesByConversation[id];
      const isStreaming = !!this.runtimes[id]?.isStreaming;

      if (hasBucket && isStreaming) {
        // Don't refetch — backend hasn't persisted partial state yet, and we'd
        // clobber the live stream's messages.
        this.activeConversationId = id;
        this.error = null;
        useNotificationsStore().markSeenForConversation(useSettingsStore().profileId, id);
        return;
      }

      try {
        const settingsStore = useSettingsStore();
        const agentUrl = settingsStore.agentUrl;
        const authToken = settingsStore.authToken;

        const { conversation, messages } = await fetchConversationMessages(agentUrl, authToken, id);

        this.messagesByConversation[id] = messages.map(this.mapBackendMessage);
        const runtime = this.runtimes[id] ?? makeRuntime();
        runtime.currentTaskId = conversation.task_id ?? undefined;
        runtime.currentContextId = conversation.context_id ?? undefined;
        // isStreaming stays as-is (false for a freshly-loaded conversation)
        this.runtimes[id] = runtime;
        this.activeConversationId = id;
        this.error = null;
        useNotificationsStore().markSeenForConversation(settingsStore.profileId, id);
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

      const reasoningModelLabel = msg.thinking_steps
        ?.find(s => s.reasoning_model_label)?.reasoning_model_label ?? undefined;

      const tokenUsage: TokenUsage | undefined = msg.token_usage
        ? {
            inputTokens: msg.token_usage.input_tokens,
            outputTokens: msg.token_usage.output_tokens,
            totalTokens: (msg.token_usage.input_tokens || 0) + (msg.token_usage.output_tokens || 0),
          }
        : undefined;

      const fileAttachments: FileAttachment[] | undefined = msg.parts
        ? msg.parts
            .filter((p: any) => p.kind === 'file' && p.file)
            .map((p: any) => ({
              name: p.file.name || p.file.Name || 'file',
              mimeType: p.file.mimeType || p.file.mime_type || 'application/octet-stream',
              uri: p.file.uri || p.file.Uri || '',
            }))
        : undefined;

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
     * Switch to the empty "new chat" landing slot. Does not affect
     * any in-flight streams in other conversations (or temp-id streams);
     * they keep running in the background.
     */
    switchToNewChat() {
      this.activeConversationId = null;
      this.error = null;
    },

    /**
     * "New Chat" button. Identical to switchToNewChat — kept as a separate
     * method so existing callers (App.vue) don't need to change semantics.
     */
    clearConversation() {
      this.activeConversationId = null;
      this.error = null;
    },

    /**
     * Delete a single saved conversation. If it's currently streaming,
     * cancel its stream first.
     */
    async deleteConversation(id: string) {
      if (this.runtimes[id]?.isStreaming) {
        await this.stopMessage(id);
      }
      try {
        const settingsStore = useSettingsStore();
        await apiDeleteConversation(settingsStore.agentUrl, settingsStore.authToken, id);
      } catch (e) {
        console.error('Failed to delete conversation:', e);
      }
      this.conversations = this.conversations.filter(c => c.id !== id);
      delete this.messagesByConversation[id];
      delete this.runtimes[id];
      const settingsStore = useSettingsStore();
      if (settingsStore.profileId) {
        useNotificationsStore().clearForConversation(settingsStore.profileId, id);
      }
      if (this.activeConversationId === id) {
        this.activeConversationId = null;
      }
    },

    /**
     * Clear all saved conversations. Cancels every in-flight stream first.
     */
    async clearAllConversations() {
      for (const id of Object.keys(this.runtimes)) {
        if (this.runtimes[id].isStreaming) {
          await this.stopMessage(id);
        }
      }
      try {
        const settingsStore = useSettingsStore();
        const profile = settingsStore.profileId;
        if (profile) {
          await apiDeleteAllConversations(settingsStore.agentUrl, settingsStore.authToken, profile);
        }
      } catch (e) {
        console.error('Failed to clear conversations:', e);
      }
      const settings = useSettingsStore();
      if (settings.profileId) {
        useNotificationsStore().clearAll(settings.profileId);
      }
      this.conversations = [];
      this.activeConversationId = null;
      this.messagesByConversation = {};
      this.runtimes = {};
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
