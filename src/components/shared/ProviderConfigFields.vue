<script setup lang="ts">
import { ElForm, ElFormItem, ElInput, ElTag, ElButton } from 'element-plus';
import type { LLMProvider, LLMModel, ProviderConfigField } from '../../services/configApi';

export interface ProviderWithState extends LLMProvider {
  apiKey: string;
  configValues: Record<string, string>;
  models: LLMModel[];
}

withDefaults(defineProps<{
  provider: ProviderWithState;
  showConfiguredBadge?: boolean;
  showSaveButtons?: boolean;
  saving?: boolean;
}>(), {
  showConfiguredBadge: false,
  showSaveButtons: false,
  saving: false,
});

const emit = defineEmits<{
  'save-key': [];
  'save-config': [];
}>();
</script>

<template>
  <div class="provider-config-fields">
    <div class="provider-status">
      <ElTag v-if="provider.apiKey || provider.configured || (provider.config_fields && Object.values(provider.configValues).some(v => v))" type="success" size="small">Configured</ElTag>
      <ElTag v-else-if="!provider.requires_api_key && !provider.config_fields" type="info" size="small">No Key Needed</ElTag>
      <ElTag v-else type="warning" size="small">Not Configured</ElTag>
    </div>

    <ElForm v-if="provider.requires_api_key" label-position="top" size="small" class="key-form">
      <ElFormItem label="API Key">
        <div :class="showSaveButtons ? 'key-input-row' : ''">
          <ElInput
            :model-value="provider.apiKey"
            @update:model-value="provider.apiKey = $event"
            type="password"
            show-password
            :placeholder="`Enter ${provider.display_name} API key`"
          />
          <ElButton v-if="showSaveButtons" type="primary" :loading="saving" @click="emit('save-key')" size="small">Save</ElButton>
        </div>
      </ElFormItem>
    </ElForm>

    <template v-if="provider.config_fields && Object.keys(provider.config_fields).length > 0">
      <ElForm label-position="top" size="small" class="config-fields-form">
        <ElFormItem
          v-for="(field, key) in (provider.config_fields as Record<string, ProviderConfigField>)"
          :key="key"
          :required="field.required"
        >
          <template #label>
            {{ field.description || key }}
            <ElTag v-if="showConfiguredBadge && field.configured" type="success" size="small" style="margin-left: 6px;">Set</ElTag>
          </template>
          <ElInput
            v-if="field.type === 'json'"
            :model-value="provider.configValues[key]"
            @update:model-value="provider.configValues[key] = $event"
            type="textarea"
            :rows="showSaveButtons ? 4 : 3"
            :placeholder="showConfiguredBadge && field.configured ? '(already set — paste new JSON to replace)' : `Paste ${field.description}`"
          />
          <ElInput
            v-else-if="field.secret"
            :model-value="provider.configValues[key]"
            @update:model-value="provider.configValues[key] = $event"
            type="password"
            show-password
            :placeholder="showConfiguredBadge && field.configured ? '(already set)' : `Enter ${field.description}`"
          />
          <ElInput
            v-else
            :model-value="provider.configValues[key]"
            @update:model-value="provider.configValues[key] = $event"
            :placeholder="field.default ? `Default: ${field.default}` : `Enter ${field.description}`"
          />
        </ElFormItem>
        <ElButton v-if="showSaveButtons" type="primary" :loading="saving" @click="emit('save-config')" size="small">Save Configuration</ElButton>
      </ElForm>
    </template>

    <div v-if="!showSaveButtons && provider.models.length > 0" class="model-count">
      {{ provider.models.length }} model(s) available
    </div>
  </div>
</template>

<style scoped>
.provider-status { margin-bottom: 8px; }

.key-form { max-width: 100%; }
.key-input-row { display: flex; gap: 8px; width: 100%; }
.key-input-row .el-input { flex: 1; }

.config-fields-form { max-width: 100%; margin-top: 8px; }

.model-count {
  font-size: 0.8rem;
  color: var(--text-tertiary);
  margin-top: 4px;
}
</style>
