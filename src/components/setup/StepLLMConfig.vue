<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { ElForm, ElFormItem, ElSelect, ElOption, ElCard } from 'element-plus';
import { listLLMProviders, getProviderModels } from '../../services/configApi';
import { useLLMModels } from '../../composables/useLLMModels';
import ProviderConfigFields, { type ProviderWithState } from '../shared/ProviderConfigFields.vue';

const props = defineProps<{
  agentUrl: string;
  config: Record<string, string>;
}>();

const emit = defineEmits<{
  update: [config: Record<string, string>];
}>();

const { rebuildModelList, getFilteredModels, getReasoningOptions } = useLLMModels();

const providers = ref<ProviderWithState[]>([]);
const selectedDefaultProvider = ref(props.config.default_provider || 'groq');
const modelGroupHigh = ref(props.config['model_group.high'] || '');
const modelGroupLow = ref(props.config['model_group.low'] || '');
const reasoningEffortHigh = ref(props.config['model_group.high.reasoning_effort'] || '');
const reasoningEffortLow = ref(props.config['model_group.low.reasoning_effort'] || '');
const loading = ref(false);

const filteredModels = computed(() => getFilteredModels(selectedDefaultProvider.value));

const highModelReasoningOptions = computed(() => getReasoningOptions(modelGroupHigh.value));
const lowModelReasoningOptions = computed(() => getReasoningOptions(modelGroupLow.value));

// Clear reasoning_effort when model changes and new model doesn't support it
watch(modelGroupHigh, () => {
  if (highModelReasoningOptions.value.length === 0) reasoningEffortHigh.value = '';
});
watch(modelGroupLow, () => {
  if (lowModelReasoningOptions.value.length === 0) reasoningEffortLow.value = '';
});

onMounted(async () => {
  loading.value = true;
  try {
    const res = await listLLMProviders(props.agentUrl, '');
    providers.value = res.providers.map((p) => ({
      ...p,
      apiKey: props.config[`${p.name}.api_key`] || '',
      configValues: Object.fromEntries(
        Object.keys(p.config_fields || {}).map(k => [k, props.config[`${p.name}.${k}`] || ''])
      ),
      models: [],
    }));

    for (const p of providers.value) {
      try {
        const modelRes = await getProviderModels(props.agentUrl, '', p.name);
        p.models = modelRes.models;
      } catch { /* Provider catalog may not exist */ }
    }

    rebuildModelList(providers.value);
  } catch {
    // Fallback: show empty provider cards
  } finally {
    loading.value = false;
  }
});

function emitConfig() {
  const config: Record<string, string> = {
    default_provider: selectedDefaultProvider.value,
  };
  if (modelGroupHigh.value) config['model_group.high'] = modelGroupHigh.value;
  if (modelGroupLow.value) config['model_group.low'] = modelGroupLow.value;
  if (reasoningEffortHigh.value) config['model_group.high.reasoning_effort'] = reasoningEffortHigh.value;
  if (reasoningEffortLow.value) config['model_group.low.reasoning_effort'] = reasoningEffortLow.value;

  for (const p of providers.value) {
    if (p.apiKey) config[`${p.name}.api_key`] = p.apiKey;
    for (const [key, value] of Object.entries(p.configValues)) {
      if (value) config[`${p.name}.${key}`] = value;
    }
  }

  emit('update', config);
}

watch([selectedDefaultProvider, modelGroupHigh, modelGroupLow, reasoningEffortHigh, reasoningEffortLow], emitConfig);
watch(providers, emitConfig, { deep: true });
</script>

<template>
  <div class="step-llm-config">
    <h3 class="step-title">LLM Provider Configuration</h3>
    <p class="step-description">
      Configure at least one LLM provider with an API key, then assign models to the
      <strong>High</strong> (reasoning) and <strong>Low</strong> (tools) groups.
    </p>

    <div v-if="loading" class="loading-state">Loading providers...</div>

    <div v-else class="providers-grid">
      <ElCard v-for="p in providers" :key="p.name" class="provider-card" shadow="hover">
        <template #header>
          <div class="provider-header">
            <span class="provider-name">{{ p.display_name }}</span>
          </div>
        </template>
        <ProviderConfigFields :provider="p" />
      </ElCard>
    </div>

    <div class="model-groups-section">
      <h4 class="section-subtitle">Model Groups</h4>
      <p class="step-description">
        The <strong>High</strong> group is used for reasoning. The <strong>Low</strong> group is for tool calls.
      </p>

      <ElForm label-position="top" class="groups-form">
        <ElFormItem label="Default Provider">
          <ElSelect v-model="selectedDefaultProvider" placeholder="Select default provider">
            <ElOption v-for="p in providers" :key="p.name" :label="p.display_name" :value="p.name" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem label="High Group (Reasoning)">
          <ElSelect v-model="modelGroupHigh" placeholder="Select reasoning model" filterable>
            <ElOption v-for="m in filteredModels" :key="m.value" :label="m.label" :value="m.value" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem v-if="highModelReasoningOptions.length > 0" label="Reasoning Effort (High Group)">
          <ElSelect v-model="reasoningEffortHigh" placeholder="Select reasoning effort" clearable>
            <ElOption v-for="opt in highModelReasoningOptions" :key="opt" :label="opt" :value="opt" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem label="Low Group (Tools)">
          <ElSelect v-model="modelGroupLow" placeholder="Select tools model" filterable>
            <ElOption v-for="m in filteredModels" :key="m.value" :label="m.label" :value="m.value" />
          </ElSelect>
        </ElFormItem>

        <ElFormItem v-if="lowModelReasoningOptions.length > 0" label="Reasoning Effort (Low Group)">
          <ElSelect v-model="reasoningEffortLow" placeholder="Select reasoning effort" clearable>
            <ElOption v-for="opt in lowModelReasoningOptions" :key="opt" :label="opt" :value="opt" />
          </ElSelect>
        </ElFormItem>
      </ElForm>
    </div>
  </div>
</template>

<style scoped>
.step-llm-config { padding: 8px 0; }

.step-title {
  font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0 0 8px 0;
}

.step-description {
  color: var(--text-secondary); font-size: 0.875rem; margin: 0 0 20px 0; line-height: 1.5;
}

.loading-state { text-align: center; padding: 40px; color: var(--text-secondary); }

.providers-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px; margin-bottom: 28px;
}

.provider-card { background: var(--surface-color); }

.provider-header { display: flex; align-items: center; justify-content: space-between; }

.provider-name { font-weight: 600; font-size: 0.95rem; }

.model-groups-section { margin-top: 8px; }

.section-subtitle {
  font-size: 1rem; font-weight: 600; color: var(--text-primary); margin: 0 0 4px 0;
}

.groups-form { max-width: 480px; }
</style>
