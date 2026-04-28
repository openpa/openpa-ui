<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { ElBadge, ElPopover, ElSwitch, ElTooltip } from 'element-plus';
import { useSettingsStore } from '../stores/settings';
import { useChatStore } from '../stores/chat';
import { useNotificationsStore } from '../stores/notifications';
import AgentCard from './AgentCard.vue';
import NotificationList from './NotificationList.vue';
import { openNotificationsStream, type NotificationStreamHandle } from '../services/notificationsStream';

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();
const chatStore = useChatStore();
const notificationsStore = useNotificationsStore();

let notificationsStream: NotificationStreamHandle | null = null;

onMounted(() => {
  notificationsStore.hydrate();
});

// Open the notifications stream reactively to auth state. The Sidebar mounts
// before App.vue's onMounted finishes activating the profile on direct page
// load, so a one-shot onMounted subscription would silently abort with no
// authToken and never retry. Watching the auth deps with immediate:true
// fires once on mount (returning early if no token yet) and again the moment
// the token becomes available, so server-triggered runs (skill events) can
// reach the sidebar even when the user navigated straight to a deep link.
const closeNotificationsStream = () => {
  if (notificationsStream !== null) {
    notificationsStream.close();
    notificationsStream = null;
  }
};

watch(
  () => [settingsStore.authToken, settingsStore.profileId] as const,
  ([token, profileId]) => {
    closeNotificationsStream();
    if (!token || !profileId) return;
    notificationsStream = openNotificationsStream(
      settingsStore.agentUrl,
      token,
      Date.now(),
      (entry) => {
        console.log('[debug:notif] received entry', {
          kind: entry.kind,
          conversation_id: entry.conversation_id,
          id: entry.id,
          created_at: entry.created_at,
        });
        // Server-triggered runs (skill events) have no client POST that
        // would open the per-conversation SSE. The 'started' kind exists so
        // the sidebar can lazily open that SSE and the streaming-dot lights
        // up even for conversations the user has never visited this session.
        if (entry.kind === 'started') {
          console.log('[debug:notif] handling started for', entry.conversation_id);
          const { runtime } = chatStore.ensureBucket(entry.conversation_id);
          runtime.isStreaming = true;
          runtime.startedAt = Date.now();
          chatStore.trackConversation(entry.conversation_id, 'streaming');
          return;
        }
        notificationsStore.push(profileId, {
          id: entry.id,
          conversationId: entry.conversation_id,
          conversationTitle: entry.conversation_title,
          messagePreview: entry.message_preview,
          kind: entry.kind,
          createdAt: entry.created_at,
          seen: false,
        });
      },
    );
  },
  { immediate: true },
);

onBeforeUnmount(closeNotificationsStream);

const bellPopoverVisible = ref(false);

const totalUnread = computed(() =>
  settingsStore.profileId ? notificationsStore.totalUnread(settingsStore.profileId) : 0,
);

const unreadFor = (conversationId: string): number =>
  settingsStore.profileId
    ? notificationsStore.unreadCountForConversation(settingsStore.profileId, conversationId)
    : 0;

const hasErrorFor = (conversationId: string): boolean =>
  settingsStore.profileId
    ? notificationsStore.hasErrorForConversation(settingsStore.profileId, conversationId)
    : false;

const isStreamingConversation = (conversationId: string): boolean =>
  chatStore.streamingConversationIds.has(conversationId);

const handleSelectNotification = (conversationId: string) => {
  bellPopoverVisible.value = false;
  const profile = route.params.profile as string;
  if (!profile) return;
  router.push({ name: 'conversation', params: { profile, conversationId } });
};

// True when the user is currently in a brand-new (not yet saved) chat.
// Either nothing has been sent (active === null) or a temp-id is in flight.
const isOnCurrentChat = computed(() =>
  chatStore.activeConversationId === null
  || (chatStore.activeConversationId?.startsWith('temp-') ?? false),
);

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

const handleOpenProcessManager = () => {
  const profile = route.params.profile as string;
  if (!profile) return;
  router.push({ name: 'process-list', params: { profile } });
};

const handleOpenEvents = () => {
  const profile = route.params.profile as string;
  if (!profile) return;
  router.push({ name: 'skill-events', params: { profile } });
};

const handleLogout = () => {
  emit('logout');
};

const handleSwitchToCurrentChat = () => {
  // No-op if we're already on the current/new chat (whether at the empty
  // landing slot or in a still-temp-id new chat). Otherwise navigate to /.
  if (isOnCurrentChat.value) return;
  const profile = route.params.profile as string;
  router.push({ name: 'chat', params: { profile } });
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

const isCollapsed = computed(() => settingsStore.sidebarCollapsed);

const toggleCollapsed = () => {
  settingsStore.setSidebarCollapsed(!isCollapsed.value);
};

const toggleThemeFromIcon = () => {
  settingsStore.setTheme(settingsStore.theme === 'dark' ? 'light' : 'dark');
};
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: isCollapsed }">
    <!-- Agent Connection Panel -->
    <div class="sidebar-section agent-section">
      <AgentCard
        :agentCard="chatStore.agentCard"
        :isConnected="chatStore.isConnected"
        :compact="isCollapsed"
        @connect="chatStore.connect"
        @disconnect="chatStore.disconnect"
      >
        <template #header-action>
          <ElTooltip
            :content="isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            placement="right"
            :show-after="300"
          >
            <button class="collapse-button" @click.stop="toggleCollapsed">
              <Icon :icon="isCollapsed ? 'mdi:chevron-double-right' : 'mdi:chevron-double-left'" />
            </button>
          </ElTooltip>
        </template>
      </AgentCard>
    </div>

    <!-- Conversation History -->
    <div class="sidebar-section conversations-section">
      <div class="section-header" v-if="!isCollapsed">
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
      <div class="section-header collapsed-header" v-else>
        <ElTooltip content="New conversation" placement="right" :show-after="300">
          <button class="icon-button" @click="handleNewChat">
            <Icon icon="mdi:plus" />
          </button>
        </ElTooltip>
      </div>
      <div class="conversation-list">
        <!-- Current Chat (always first) -->
        <ElTooltip
          :content="isOnCurrentChat ? 'Current Chat' : 'New Chat'"
          placement="right"
          :show-after="300"
          :disabled="!isCollapsed"
        >
          <div
            class="conversation-item"
            :class="{ active: isOnCurrentChat }"
            @click="handleSwitchToCurrentChat"
          >
            <Icon icon="mdi:message-text" class="conversation-icon" />
            <div class="conversation-info" v-if="!isCollapsed">
              <div class="conversation-title">{{ isOnCurrentChat ? 'Current Chat' : 'New Chat' }}</div>
              <div class="conversation-preview" v-if="isOnCurrentChat">{{ chatStore.messages.length }} messages</div>
            </div>
          </div>
        </ElTooltip>
        <!-- Saved conversations -->
        <ElTooltip
          v-for="conv in sortedConversations"
          :key="conv.id"
          :content="conv.title"
          placement="right"
          :show-after="300"
          :disabled="!isCollapsed"
        >
          <ElBadge
            :value="unreadFor(conv.id)"
            :hidden="unreadFor(conv.id) === 0"
            :max="9"
            :type="hasErrorFor(conv.id) ? 'danger' : 'primary'"
            class="conversation-badge-wrap"
          >
            <div
              class="conversation-item"
              :class="{ active: chatStore.activeConversationId === conv.id, streaming: isStreamingConversation(conv.id) }"
              @click="handleSwitchConversation(conv.id)"
            >
              <Icon icon="mdi:message-text-outline" class="conversation-icon" />
              <span
                v-if="isStreamingConversation(conv.id)"
                class="streaming-dot"
                title="Streaming"
              />
              <div class="conversation-info" v-if="!isCollapsed">
                <div class="conversation-title">{{ conv.title }}</div>
                <div class="conversation-preview">{{ conv.messageCount ?? 0 }} messages</div>
              </div>
              <button v-if="!isCollapsed" class="delete-conversation-btn" @click="handleDeleteConversation(conv.id, $event)" title="Delete conversation">
                <Icon icon="mdi:close" />
              </button>
            </div>
          </ElBadge>
        </ElTooltip>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="sidebar-section bottom-section">
      <ElPopover
        :visible="bellPopoverVisible"
        placement="right-end"
        trigger="click"
        :width="320"
        @update:visible="bellPopoverVisible = $event"
      >
        <template #reference>
          <ElTooltip content="Notifications" placement="right" :show-after="300" :disabled="!isCollapsed">
            <div class="settings-row notifications-row" @click="bellPopoverVisible = !bellPopoverVisible">
              <ElBadge
                :value="totalUnread"
                :hidden="totalUnread === 0"
                :max="99"
                class="notifications-badge"
              >
                <Icon icon="mdi:bell-outline" class="settings-icon" />
              </ElBadge>
              <span class="settings-label" v-if="!isCollapsed">Notifications</span>
              <Icon icon="mdi:chevron-right" class="chevron-icon" v-if="!isCollapsed" />
            </div>
          </ElTooltip>
        </template>
        <NotificationList @select="handleSelectNotification" />
      </ElPopover>
      <ElTooltip content="Settings" placement="right" :show-after="300" :disabled="!isCollapsed">
        <div class="settings-row" @click="handleOpenSettings">
          <Icon icon="mdi:cog" class="settings-icon" />
          <span class="settings-label" v-if="!isCollapsed">Settings</span>
          <Icon icon="mdi:chevron-right" class="chevron-icon" v-if="!isCollapsed" />
        </div>
      </ElTooltip>
      <ElTooltip content="Logout" placement="right" :show-after="300" :disabled="!isCollapsed">
        <div class="settings-row logout-row" @click="handleLogout">
          <Icon icon="mdi:logout" class="settings-icon" />
          <span class="settings-label" v-if="!isCollapsed">Logout</span>
          <Icon icon="mdi:chevron-right" class="chevron-icon" v-if="!isCollapsed" />
        </div>
      </ElTooltip>
      <ElTooltip content="Process Manager" placement="right" :show-after="300" :disabled="!isCollapsed">
        <div class="settings-row" @click="handleOpenProcessManager">
          <Icon icon="mdi:console" class="settings-icon" />
          <span class="settings-label" v-if="!isCollapsed">Process Manager</span>
          <Icon icon="mdi:chevron-right" class="chevron-icon" v-if="!isCollapsed" />
        </div>
      </ElTooltip>
      <ElTooltip content="Events" placement="right" :show-after="300" :disabled="!isCollapsed">
        <div class="settings-row" @click="handleOpenEvents">
          <Icon icon="mdi:lightning-bolt-outline" class="settings-icon" />
          <span class="settings-label" v-if="!isCollapsed">Events</span>
          <Icon icon="mdi:chevron-right" class="chevron-icon" v-if="!isCollapsed" />
        </div>
      </ElTooltip>
      <ElTooltip
        :content="settingsStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        placement="right"
        :show-after="300"
        :disabled="!isCollapsed"
      >
        <div
          class="theme-row"
          :class="{ clickable: isCollapsed }"
          @click="isCollapsed ? toggleThemeFromIcon() : null"
        >
          <Icon
            :icon="settingsStore.theme === 'dark' ? 'mdi:weather-night' : 'mdi:weather-sunny'"
            class="theme-icon"
          />
          <span class="theme-label" v-if="!isCollapsed">Dark Mode</span>
          <ElSwitch
            v-if="!isCollapsed"
            :model-value="settingsStore.theme === 'dark'"
            @change="handleThemeToggle"
            size="small"
          />
        </div>
      </ElTooltip>
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
  transition: width 0.2s ease;
}

.sidebar.collapsed {
  width: var(--sidebar-width-collapsed);
}

.collapse-button {
  width: 28px;
  height: 28px;
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
  font-size: 18px;
}

.collapse-button:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
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

/* ElBadge wraps content in an inline-block; force it to fill the sidebar
   width so the conversation row stays full-width. */
.conversation-badge-wrap {
  display: block;
  width: 100%;
}

.conversation-badge-wrap :deep(.el-badge__content) {
  z-index: 2;
}

/* Notifications row in the bottom actions */
.notifications-row {
  align-items: center;
}

.notifications-badge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.notifications-badge :deep(.el-badge__content) {
  border: none;
  font-size: 10px;
  height: 14px;
  line-height: 14px;
  padding: 0 4px;
}

.streaming-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary-color);
  animation: pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
  margin-left: -4px;
}

.conversation-item.streaming .streaming-dot {
  background: var(--primary-color);
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
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

.theme-row.clickable {
  cursor: pointer;
}

.theme-row.clickable:hover {
  background: var(--hover-bg);
}

/* Collapsed-mode layout overrides */
.sidebar.collapsed .sidebar-section {
  padding: 8px 0;
}

.sidebar.collapsed .agent-section {
  padding: 0;
}

.sidebar.collapsed .bottom-section {
  padding: 8px 0;
}

.sidebar.collapsed .conversations-section {
  padding: 8px 0;
}

.sidebar.collapsed .collapsed-header {
  display: flex;
  justify-content: center;
  margin-bottom: 6px;
  padding: 0;
}

.sidebar.collapsed .settings-row,
.sidebar.collapsed .theme-row,
.sidebar.collapsed .conversation-item {
  justify-content: center;
  padding: 10px 0;
  gap: 0;
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
