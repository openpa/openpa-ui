<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useNotificationsStore } from '../stores/notifications';
import { useSettingsStore } from '../stores/settings';

const emit = defineEmits<{
  select: [conversationId: string];
}>();

const notifications = useNotificationsStore();
const settings = useSettingsStore();

const items = computed(() => notifications.forProfile(settings.profileId));

const handleSelect = (conversationId: string) => {
  emit('select', conversationId);
};

const handleClearAll = () => {
  if (settings.profileId) notifications.clearAll(settings.profileId);
};

const handleMarkAllSeen = () => {
  if (settings.profileId) notifications.markAllSeen(settings.profileId);
};

const formatTime = (ts: number): string => {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};
</script>

<template>
  <div class="notification-list">
    <div class="notification-header">
      <span class="notification-title">Notifications</span>
      <div class="notification-actions">
        <button
          v-if="items.length > 0"
          class="header-btn"
          @click="handleMarkAllSeen"
          title="Mark all as seen"
        >
          <Icon icon="mdi:eye-check-outline" />
        </button>
        <button
          v-if="items.length > 0"
          class="header-btn"
          @click="handleClearAll"
          title="Clear all"
        >
          <Icon icon="mdi:delete-outline" />
        </button>
      </div>
    </div>

    <div v-if="items.length === 0" class="notification-empty">
      <Icon icon="mdi:bell-off-outline" class="empty-icon" />
      <span>No notifications yet</span>
    </div>

    <div v-else class="notification-items">
      <div
        v-for="entry in items"
        :key="entry.id"
        class="notification-item"
        :class="{ unseen: !entry.seen, error: entry.kind === 'error' }"
        @click="handleSelect(entry.conversationId)"
      >
        <div class="notification-dot" :class="{ unseen: !entry.seen }" />
        <div class="notification-body">
          <div class="notification-row">
            <span class="conv-title">{{ entry.conversationTitle }}</span>
            <span class="time">{{ formatTime(entry.createdAt) }}</span>
          </div>
          <div class="preview" :class="{ 'error-text': entry.kind === 'error' }">
            <Icon
              v-if="entry.kind === 'error'"
              icon="mdi:alert-circle-outline"
              class="kind-icon"
            />
            <Icon
              v-else
              icon="mdi:check-circle-outline"
              class="kind-icon"
            />
            <span>{{ entry.messagePreview || (entry.kind === 'error' ? 'Stream error' : 'Response ready') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notification-list {
  display: flex;
  flex-direction: column;
  max-height: 420px;
  min-width: 280px;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 8px;
  border-bottom: 1px solid var(--border-color);
}

.notification-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.notification-actions {
  display: flex;
  gap: 2px;
}

.header-btn {
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 14px;
  padding: 0;
}

.header-btn:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.notification-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 12px;
  color: var(--text-tertiary);
  font-size: 0.85rem;
  gap: 8px;
}

.empty-icon {
  font-size: 28px;
  opacity: 0.6;
}

.notification-items {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.notification-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 6px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s ease;
  border-bottom: 1px solid var(--border-color);
}

.notification-item:last-child {
  border-bottom: none;
}

.notification-item:hover {
  background: var(--hover-bg);
}

.notification-item.unseen {
  background: rgba(37, 99, 235, 0.06);
}

.notification-item.unseen.error {
  background: rgba(239, 68, 68, 0.06);
}

.notification-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  background: transparent;
  flex-shrink: 0;
}

.notification-dot.unseen {
  background: var(--primary-color);
}

.notification-item.error .notification-dot.unseen {
  background: #ef4444;
}

.notification-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notification-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.conv-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.time {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.preview {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview.error-text {
  color: #ef4444;
}

.kind-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.preview span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
