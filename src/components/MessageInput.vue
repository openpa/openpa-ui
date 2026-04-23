<script setup lang="ts">
import { ref } from 'vue';
import { ElInput, ElPopover, ElSwitch } from 'element-plus';
import { Icon } from '@iconify/vue';

const props = withDefaults(defineProps<{
  disabled?: boolean;
  isProcessing?: boolean;
  reasoningEnabled?: boolean;
}>(), {
  reasoningEnabled: true,
});

const emit = defineEmits<{
  send: [text: string];
  stop: [];
  'update:reasoningEnabled': [enabled: boolean];
}>();

const inputText = ref('');
const popoverVisible = ref(false);

const handleClick = () => {
  if (props.isProcessing) {
    emit('stop');
    return;
  }
  if (inputText.value.trim() && !props.disabled) {
    emit('send', inputText.value.trim());
    inputText.value = '';
  }
};

const handleKeydown = (event: Event | KeyboardEvent) => {
  // Enter to send (no-op while processing so it can't accidentally stop),
  // Shift+Enter for newline.
  if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!props.isProcessing) handleClick();
  }
};

const handleReasoningToggle = (value: boolean | string | number) => {
  emit('update:reasoningEnabled', Boolean(value));
  popoverVisible.value = false;
};
</script>

<template>
  <div class="message-input-container">
    <div class="input-wrapper">
      <ElInput
        v-model="inputText"
        type="textarea"
        :rows="3"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
        @keydown="handleKeydown"
        :disabled="disabled"
        class="message-input"
      />
      <ElPopover
        :visible="popoverVisible"
        placement="top"
        :width="180"
        @update:visible="popoverVisible = $event"
      >
        <template #reference>
          <button
            class="reasoning-toggle-button"
            :class="{ 'active': reasoningEnabled }"
            @click="popoverVisible = !popoverVisible"
            type="button"
          >
            <Icon icon="mdi:chevron-up" />
          </button>
        </template>
        <div class="reasoning-popover-content">
          <span>Reasoning</span>
          <ElSwitch
            :model-value="reasoningEnabled"
            @update:model-value="handleReasoningToggle"
            size="small"
          />
        </div>
      </ElPopover>
      <button
        @click="handleClick"
        :disabled="!isProcessing && (disabled || !inputText.trim())"
        class="send-button"
        :class="{
          'disabled': !isProcessing && (disabled || !inputText.trim()),
          'stop': isProcessing,
        }"
        :title="isProcessing ? 'Stop' : 'Send'"
      >
        <Icon :icon="isProcessing ? 'mdi:stop' : 'mdi:send'" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-input-container {
  padding: 12px 16px;
  background: var(--surface-color);
  border-top: 1px solid var(--border-color);
  position: relative;
  flex-shrink: 0;
  max-height: 40vh;
  overflow-y: auto;
}

.input-wrapper {
  position: relative;
}

.message-input {
  width: 100%;
}

/* Override Element Plus textarea styles */
.message-input :deep(.el-textarea__inner) {
  background: var(--surface-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 44px 10px 14px;
  color: var(--text-primary);
  font-size: 0.95em;
  line-height: 1.6;
  transition: all 0.2s ease;
}

.message-input :deep(.el-textarea__inner::placeholder) {
  color: var(--text-tertiary);
}

.message-input :deep(.el-textarea__inner:focus) {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.message-input :deep(.el-textarea__inner:disabled) {
  opacity: 0.6;
  cursor: not-allowed;
  background: var(--surface-hover);
}

.reasoning-toggle-button {
  position: absolute;
  bottom: 42px;
  right: 10px;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s ease;
  padding: 0;
}

.reasoning-toggle-button:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.reasoning-toggle-button.active {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: rgba(37, 99, 235, 0.08);
}

.reasoning-popover-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-primary);
}

.send-button {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  background: var(--primary-color);
  border: none;
  border-radius: 6px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: all 0.2s ease;
  padding: 0;
}

.send-button:hover:not(:disabled) {
  background: var(--primary-light);
}

.send-button:active:not(:disabled) {
  transform: scale(0.95);
}

.send-button.disabled,
.send-button:disabled {
  background: var(--text-tertiary);
  cursor: not-allowed;
  opacity: 0.4;
}

.send-button.stop {
  background: #ef4444;
  cursor: pointer;
  opacity: 1;
}

.send-button.stop:hover {
  background: #dc2626;
}
</style>
