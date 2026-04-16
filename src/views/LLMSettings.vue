<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElForm, ElFormItem, ElSelect, ElOption, ElButton, ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useSettingsStore } from '../stores/settings';
import {
  listLLMProviders,
  getProviderModels,
  updateProvider,
  getModelGroups,
  updateModelGroups,
} from '../services/configApi';
import { useLLMModels } from '../composables/useLLMModels';
import ProviderConfigFields, { type ProviderWithState } from '../components/shared/ProviderConfigFields.vue';

const props = defineProps<{ profile: string }>();
const router = useRouter();
const settingsStore = useSettingsStore();
const { rebuildModelList, getFilteredModels, getReasoningOptions } = useLLMModels();

const providers = ref<ProviderWithState[]>([]);
const modelGroups = ref<Record<string, string>>({ high: '', low: '' });
const reasoningEfforts = ref<Record<string, string | null>>({ high: null, low: null });
const defaultProvider = ref('groq');
const loading = ref(false);
const saving = ref(false);

const selectedProvider = computed(() =>
  providers.value.find(p => p.name === defaultProvider.value) || null
);

const filteredModels = computed(() => getFilteredModels(defaultProvider.value));
const highModelReasoningOptions = computed(() => getReasoningOptions(modelGroups.value.high));
const lowModelReasoningOptions = computed(() => getReasoningOptions(modelGroups.value.low));

watch(() => modelGroups.value.high, () => {
  if (highModelReasoningOptions.value.length === 0) reasoningEfforts.value.high = null;
});
watch(() => modelGroups.value.low, () => {
  if (lowModelReasoningOptions.value.length === 0) reasoningEfforts.value.low = null;
});

onMounted(async () => {
  loading.value = true;
  try {
    const [provRes, groupRes] = await Promise.all([
      listLLMProviders(settingsStore.agentUrl, settingsStore.authToken),
      getModelGroups(settingsStore.agentUrl, settingsStore.authToken),
    ]);

    providers.value = provRes.providers.map((p) => ({
      ...p,
      apiKey: '',
      configValues: { ...(p.current_values || {}) },
      models: [],
    }));

    modelGroups.value = groupRes.model_groups;
    defaultProvider.value = groupRes.default_provider;

    for (const p of providers.value) {
      try {
        const modelRes = await getProviderModels(settingsStore.agentUrl, settingsStore.authToken, p.name);
        p.models = modelRes.models;
      } catch { /* ignore */ }
    }

    rebuildModelList(providers.value);
    reasoningEfforts.value = groupRes.reasoning_efforts || { high: null, low: null };
  } catch (e) {
    ElMessage.error('Failed to load LLM settings');
  } finally {
    loading.value = false;
  }
});

async function saveProviderKey(provider: ProviderWithState) {
  if (!provider.apiKey) return;
  saving.value = true;
  try {
    await updateProvider(settingsStore.agentUrl, settingsStore.authToken, provider.name, {
      api_key: provider.apiKey,
    });
    provider.configured = true;
    ElMessage.success(`${provider.display_name} API key saved`);
  } catch (e) {
    ElMessage.error(`Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`);
  } finally {
    saving.value = false;
  }
}

async function saveProviderConfig(provider: ProviderWithState) {
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(provider.configValues)) {
    if (value) config[key] = value;
  }
  if (Object.keys(config).length === 0) return;

  for (const [key, value] of Object.entries(config)) {
    if (provider.config_fields?.[key]?.type === 'json') {
      try {
        JSON.parse(value);
      } catch {
        ElMessage.error(`Invalid JSON for ${provider.config_fields[key].description || key}`);
        return;
      }
    }
  }

  saving.value = true;
  try {
    await updateProvider(settingsStore.agentUrl, settingsStore.authToken, provider.name, config);
    for (const key of Object.keys(config)) {
      if (provider.config_fields?.[key]) {
        provider.config_fields[key].configured = true;
      }
    }
    provider.configured = true;
    ElMessage.success(`${provider.display_name} configuration saved`);
  } catch (e) {
    ElMessage.error(`Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`);
  } finally {
    saving.value = false;
  }
}

async function saveModelGroups() {
  saving.value = true;
  try {
    await updateModelGroups(
      settingsStore.agentUrl,
      settingsStore.authToken,
      modelGroups.value,
      defaultProvider.value,
      reasoningEfforts.value,
    );
    ElMessage.success('Model groups updated');
  } catch (e) {
    ElMessage.error('Failed to save model groups');
  } finally {
    saving.value = false;
  }
}

function goBack() {
  router.push(`/${props.profile}/settings`);
}
</script>

<template>
  <div class="llm-settings-page">
    <div class="page-container">
      <div class="page-header">
        <button class="back-btn" @click="goBack">
          <Icon icon="mdi:arrow-left" /> Back to Settings
        </button>
        <h1 class="page-title">LLM Providers</h1>
      </div>

      <div v-if="loading" class="loading-state">Loading...</div>

      <template v-else>
        <!-- Model Groups -->
        <div class="section">
          <h2 class="section-title">Model Groups</h2>
          <p class="section-description">
            <strong>High</strong> = reasoning model. <strong>Low</strong> = tool call model.
          </p>

          <ElForm label-position="top" class="groups-form">
            <ElFormItem label="Default Provider">
              <ElSelect v-model="defaultProvider">
                <ElOption v-for="p in providers" :key="p.name" :label="p.display_name" :value="p.name" />
              </ElSelect>
            </ElFormItem>

            <!-- Inline provider configuration -->
            <div v-if="selectedProvider" class="provider-config-inline">
              <ProviderConfigFields
                :provider="selectedProvider"
                :show-configured-badge="true"
                :show-save-buttons="true"
                :saving="saving"
                @save-key="saveProviderKey(selectedProvider!)"
                @save-config="saveProviderConfig(selectedProvider!)"
              />
            </div>

            <ElFormItem label="High Group (Reasoning)">
              <ElSelect v-model="modelGroups.high" filterable>
                <ElOption v-for="m in filteredModels" :key="m.value" :label="m.label" :value="m.value" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem v-if="highModelReasoningOptions.length > 0" label="Reasoning Effort (High Group)">
              <ElSelect v-model="reasoningEfforts.high" placeholder="Select reasoning effort" clearable>
                <ElOption v-for="opt in highModelReasoningOptions" :key="opt" :label="opt" :value="opt" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="Low Group (Tools)">
              <ElSelect v-model="modelGroups.low" filterable>
                <ElOption v-for="m in filteredModels" :key="m.value" :label="m.label" :value="m.value" />
              </ElSelect>
            </ElFormItem>
            <ElFormItem v-if="lowModelReasoningOptions.length > 0" label="Reasoning Effort (Low Group)">
              <ElSelect v-model="reasoningEfforts.low" placeholder="Select reasoning effort" clearable>
                <ElOption v-for="opt in lowModelReasoningOptions" :key="opt" :label="opt" :value="opt" />
              </ElSelect>
            </ElFormItem>
            <ElButton type="primary" :loading="saving" @click="saveModelGroups">Save Model Groups</ElButton>
          </ElForm>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.llm-settings-page {
  width: 100%; height: 100%; overflow-y: auto; background: var(--bg-color);
  padding: 24px; box-sizing: border-box;
}

.page-container { max-width: 720px; margin: 0 auto; }
.page-header { margin-bottom: 24px; }

.back-btn {
  display: flex; align-items: center; gap: 6px; background: none;
  border: none; color: var(--text-secondary); cursor: pointer;
  font-size: 0.875rem; padding: 4px 0; margin-bottom: 12px;
}
.back-btn:hover { color: var(--primary-color); }

.page-title { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin: 0; }
.loading-state { text-align: center; padding: 40px; color: var(--text-secondary); }

.section { margin-bottom: 32px; }
.section-title { font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0 0 8px 0; }
.section-description { color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 16px 0; }

.groups-form { max-width: 480px; }

.provider-config-inline {
  margin: 0 0 16px 0;
  padding: 12px 16px;
  border: 1px solid var(--border-color, #e4e7ed);
  border-radius: 8px;
  background: var(--surface-color, #fafafa);
}
</style>
