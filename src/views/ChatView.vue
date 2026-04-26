<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElNotification } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { useTerminalPanelStore } from '../stores/terminalPanel';
import ChatWindow from '../components/ChatWindow.vue';
import MessageInput from '../components/MessageInput.vue';
import TerminalPanel from '../components/TerminalPanel.vue';
import ResizableDivider from '../components/ResizableDivider.vue';

const props = defineProps<{
  profile?: string;
  conversationId?: string;
}>();

const router = useRouter();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const terminalPanel = useTerminalPanelStore();

const showTerminalPanel = computed(
  () => terminalPanel.openTerminals.length > 0 && !terminalPanel.minimized,
);
const showMinimizedPill = computed(
  () => terminalPanel.openTerminals.length > 0 && terminalPanel.minimized,
);

// Detect if running in Electron
const isElectron = computed(() => {
  return typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__;
});

onMounted(async () => {
  // Connect if we have active credentials but aren't connected yet
  if (settingsStore.profileId && settingsStore.authToken && !chatStore.isConnected) {
    await handleConnect();
  }

  // Deep-link: if URL contains a conversationId, load it
  if (props.conversationId && chatStore.activeConversationId !== props.conversationId) {
    try {
      await chatStore.switchConversation(props.conversationId);
    } catch (e) {
      router.replace({ name: 'chat', params: { profile: props.profile } });
    }
  } else if (chatStore.activeConversationId) {
    // Re-attach the 'active' tracker after a previous unmount (e.g. user
    // came back from Settings to the same conversation). Idempotent.
    chatStore.trackConversation(chatStore.activeConversationId, 'active');
  }
});

// Watch route param changes (in-app navigation between conversations)
watch(() => props.conversationId, async (newId, oldId) => {
  if (newId === oldId) return;
  if (newId) {
    if (chatStore.activeConversationId !== newId) {
      try {
        await chatStore.switchConversation(newId);
      } catch (e) {
        router.replace({ name: 'chat', params: { profile: props.profile } });
      }
    }
  } else {
    // Navigated to /:profile (no conversation) - switch to new chat
    chatStore.switchToNewChat();
  }
});

// Sync URL when activeConversationId changes (e.g., after first message creates a conversation)
watch(() => chatStore.activeConversationId, (newId) => {
  const currentRouteConvId = props.conversationId;
  if (newId && newId !== currentRouteConvId) {
    router.replace({ name: 'conversation', params: { profile: props.profile, conversationId: newId } });
  } else if (!newId && currentRouteConvId) {
    router.replace({ name: 'chat', params: { profile: props.profile } });
  }
});

// Drop the 'active' tracker on unmount so navigating to Settings doesn't
// keep an idle SSE open. Any 'streaming' tracker (live run in flight) keeps
// the connection alive on its own — this only releases the view's hold.
onBeforeUnmount(() => {
  const id = chatStore.activeConversationId;
  if (id) chatStore.untrackConversation(id, 'active');
});

const handleConnect = async () => {
  try {
    await chatStore.connect();
    ElNotification({
      title: 'Connected',
      message: `Connected to ${chatStore.agentName}`,
      type: 'success',
      duration: 2000,
    });
  } catch (error: any) {
    ElNotification({
      title: 'Connection Failed',
      message: error.message || 'Failed to connect to agent',
      type: 'error',
      duration: 4000,
    });
  }
};

const handleSendMessage = async (text: string) => {
  try {
    await chatStore.sendMessage(text, { reasoning: settingsStore.reasoningEnabled });
  } catch (error: any) {
    ElNotification({
      title: 'Error',
      message: error.message || 'Failed to send message',
      type: 'error',
    });
  }
};
</script>

<template>
  <div class="chat-view" :class="{ 'has-titlebar': isElectron, split: showTerminalPanel }">
    <div class="chat-section">
      <ChatWindow
        :messages="chatStore.messages"
        :isStreaming="chatStore.isStreaming"
      />

      <MessageInput
        :disabled="!chatStore.isConnected || chatStore.isStreaming"
        :isProcessing="chatStore.isStreaming"
        :reasoningEnabled="settingsStore.reasoningEnabled"
        @update:reasoningEnabled="settingsStore.setReasoningEnabled(settingsStore.profileId, $event)"
        @send="handleSendMessage"
        @stop="chatStore.stopMessage()"
      />

      <button
        v-if="showMinimizedPill"
        class="terminal-restore-pill"
        :title="'Restore terminals'"
        @click="terminalPanel.restore()"
      >
        <Icon icon="mdi:console" />
        <span>Terminals ({{ terminalPanel.openTerminals.length }})</span>
      </button>
    </div>

    <template v-if="showTerminalPanel">
      <ResizableDivider @update:width="terminalPanel.setWidth" />
      <TerminalPanel
        class="terminal-panel-host"
        :style="{ width: terminalPanel.panelWidth + 'px' }"
      />
    </template>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* When the terminal panel is visible, switch to a horizontal split layout. */
.chat-view.split {
  flex-direction: row;
}

.chat-section {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal-panel-host {
  flex-shrink: 0;
  height: 100%;
}

.terminal-restore-pill {
  position: absolute;
  right: 16px;
  bottom: 72px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #0f172a;
  color: #cbd5f5;
  border: 1px solid #1f2937;
  border-radius: 999px;
  font-size: 0.8rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 5;
}
.terminal-restore-pill:hover {
  border-color: var(--primary-color);
  color: #e5e7eb;
}
</style>
