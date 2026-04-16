<script setup lang="ts">
import { ElForm, ElFormItem, ElInput, ElTag } from 'element-plus';

const props = withDefaults(defineProps<{
  fields: Record<string, { description: string; type: string; secret: boolean; configured: boolean }>;
  values: Record<string, string>;
  title?: string;
}>(), {
  title: 'Tool Variables',
});

const emit = defineEmits<{
  'update:values': [values: Record<string, string>];
}>();

function updateValue(key: string, value: string) {
  emit('update:values', { ...props.values, [key]: value });
}
</script>

<template>
  <div class="tool-variables-form">
    <h4 class="config-section-title">{{ props.title }}</h4>
    <ElForm label-position="top" size="small">
      <ElFormItem v-for="(field, key) in fields" :key="key">
        <template #label>
          {{ field.description || key }}
          <ElTag v-if="field.configured" type="success" size="small" class="field-tag">Set</ElTag>
        </template>
        <ElInput
          :model-value="values[key] || ''"
          @update:model-value="updateValue(key as string, $event)"
          :type="field.secret ? 'password' : 'text'"
          :show-password="field.secret"
          :placeholder="field.configured ? '(already set)' : `Enter ${field.description || key}`"
        />
      </ElFormItem>
    </ElForm>
  </div>
</template>

<style scoped>
.config-section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 8px 0;
}

.field-tag { margin-left: 8px; }
</style>
