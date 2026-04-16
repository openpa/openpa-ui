<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { ElSwitch } from 'element-plus';
import { useSettingsStore } from '../stores/settings';
import { useChatStore } from '../stores/chat';
import AgentCard from './AgentCard.vue';

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const chatStore = useChatStore();

const emit = defineEmits<{
  openSettings: [];
  newChat: [];
  logout: [];
}>();

const handleThemeToggle = (val: string | number | boolean) => {
  const isDark = val === true;
  settingsStore.setTheme(isDark ? 'dark' : 'light');
};

const handleNewChat = () => {
  emit('newChat');
};

const handleOpenSettings = () => {
  // Navigate to settings page instead of opening drawer
  emit('openSettings');
};

const handleLogout = () => {
  emit('logout');
};

const handleSwitchToCurrentChat = () => {
  if (chatStore.activeConversationId !== null) {
    const profile = route.params.profile as string;
    router.push({ name: 'chat', params: { profile } });
  }
};

const handleSwitchConversation = (id: string) => {
  const profile = route.params.profile as string;
  router.push({ name: 'conversation', params: { profile, conversationId: id } });
};

const handleDeleteConversation = async (id: string, event: Event) => {
  event.stopPropagation();
  const wasActive = chatStore.activeConversationId === id;
  await chatStore.deleteConversation(id);
  if (wasActive) {
    const profile = route.params.profile as string;
    router.push({ name: 'chat', params: { profile } });
  }
};

const handleClearAllConversations = async () => {
  if (chatStore.conversations.length === 0) return;
  if (confirm('Clear all saved conversations?')) {
    await chatStore.clearAllConversations();
    const profile = route.params.profile as string;
    router.push({ name: 'chat', params: { profile } });
  }
};

const sortedConversations = computed(() => {
  return [...chatStore.conversations].sort((a, b) => b.createdAt - a.createdAt);
});
</script>

<template>
  <aside class="sidebar">
    <!-- Agent Connection Panel -->
    <div class="sidebar-section agent-section">
      <AgentCard 
        :agentCard="chatStore.agentCard" 
        :isConnected="chatStore.isConnected"
        @connect="chatStore.connect"
        @disconnect="chatStore.disconnect"
      />
    </div>

    <!-- Conversation History -->
    <div class="sidebar-section conversations-section">
      <div class="section-header">
        <span class="section-title">Conversations</span>
        <div class="section-header-actions">
          <button class="icon-button" @click="handleClearAllConversations" title="Clear all conversations" v-if="chatStore.conversations.length > 0">
            <Icon icon="mdi:delete-outline" />
          </button>
          <button class="icon-button" @click="handleNewChat" title="New conversation">
            <Icon icon="mdi:plus" />
          </button>
        </div>
      </div>
      <div class="conversation-list">
        <!-- Current Chat (always first) -->
        <div
          class="conversation-item"
          :class="{ active: chatStore.activeConversationId === null }"
          @click="handleSwitchToCurrentChat"
        >
          <Icon icon="mdi:message-text" class="conversation-icon" />
          <div class="conversation-info">
            <div class="conversation-title">{{ chatStore.activeConversationId === null ? 'Current Chat' : 'New Chat' }}</div>
            <div class="conversation-preview" v-if="chatStore.activeConversationId === null">{{ chatStore.messages.length }} messages</div>
          </div>
        </div>
        <!-- Saved conversations -->
        <div
          v-for="conv in sortedConversations"
          :key="conv.id"
          class="conversation-item"
          :class="{ active: chatStore.activeConversationId === conv.id }"
          @click="handleSwitchConversation(conv.id)"
        >
          <Icon icon="mdi:message-text-outline" class="conversation-icon" />
          <div class="conversation-info">
            <div class="conversation-title">{{ conv.title }}</div>
            <div class="conversation-preview">{{ conv.messageCount ?? 0 }} messages</div>
          </div>
          <button class="delete-conversation-btn" @click="handleDeleteConversation(conv.id, $event)" title="Delete conversation">
            <Icon icon="mdi:close" />
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="sidebar-section bottom-section">
      <div class="settings-row" @click="handleOpenSettings">
        <Icon icon="mdi:cog" class="settings-icon" />
        <span class="settings-label">Settings</span>
        <Icon icon="mdi:chevron-right" class="chevron-icon" />
      </div>
      <div class="settings-row logout-row" @click="handleLogout">
        <Icon icon="mdi:logout" class="settings-icon" />
        <span class="settings-label">Logout</span>
        <Icon icon="mdi:chevron-right" class="chevron-icon" />
      </div>
      <div class="theme-row">
        <Icon icon="mdi:weather-sunny" class="theme-icon" />
        <span class="theme-label">Dark Mode</span>
        <ElSwitch 
          :model-value="settingsStore.theme === 'dark'" 
          @change="handleThemeToggle"
          size="small"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  height: 100%;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  flex-shrink: 0;
}

.sidebar-section {
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-section:last-child {
  border-bottom: none;
}

.agent-section {
  padding: 0;
}

.conversations-section {
  flex: 1;
  overflow-y: auto;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 4px;
}

.section-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.icon-button {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  padding: 0;
}

.icon-button:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.conversation-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.conversation-item:hover {
  background: var(--hover-bg);
}

.conversation-item.active {
  background: var(--surface-hover);
  border-color: var(--border-color);
}

.conversation-icon {
  font-size: 18px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.conversation-item.active .conversation-icon {
  color: var(--primary-color);
}

.conversation-item .delete-conversation-btn {
  display: none;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  padding: 0;
  flex-shrink: 0;
  font-size: 14px;
}

.conversation-item:hover .delete-conversation-btn {
  display: flex;
}

.conversation-item .delete-conversation-btn:hover {
  color: var(--error-color, #e74c3c);
  background: var(--hover-bg);
}

.conversation-info {
  flex: 1;
  min-width: 0;
}

.conversation-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conversation-preview {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-spacer {
  flex: 1;
}

.bottom-section {
  padding: 8px;
  background: var(--surface-color);
}

.settings-row,
.theme-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.settings-row:hover {
  background: var(--hover-bg);
}

.logout-row .settings-icon,
.logout-row .settings-label {
  color: var(--error-color, #e74c3c);
}

.settings-icon,
.theme-icon {
  font-size: 18px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.settings-label,
.theme-label {
  flex: 1;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.chevron-icon {
  font-size: 16px;
  color: var(--text-tertiary);
}

.theme-row {
  cursor: default;
}

.theme-row:hover {
  background: transparent;
}

/* Responsive */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: -280px;
    top: 0;
    z-index: 1000;
    transition: left 0.3s ease;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  }
  
  .sidebar.open {
    left: 0;
  }
}
</style>
