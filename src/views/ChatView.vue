<script setup lang="ts">
import { onMounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElNotification } from 'element-plus';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import ChatWindow from '../components/ChatWindow.vue';
import MessageInput from '../components/MessageInput.vue';

const props = defineProps<{
  profile?: string;
  conversationId?: string;
}>();

const router = useRouter();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();

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
  <div class="chat-view" :class="{ 'has-titlebar': isElectron }">
    <!-- Chat messages area -->
    <ChatWindow
      :messages="chatStore.messages"
      :isStreaming="chatStore.isStreaming"
    />

    <!-- Message input -->
    <MessageInput
      :disabled="!chatStore.isConnected || chatStore.isStreaming"
      :isProcessing="chatStore.isStreaming"
      :reasoningEnabled="settingsStore.reasoningEnabled"
      @update:reasoningEnabled="settingsStore.setReasoningEnabled(settingsStore.profileId, $event)"
      @send="handleSendMessage"
      @stop="chatStore.stopMessage()"
    />
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
</style>
