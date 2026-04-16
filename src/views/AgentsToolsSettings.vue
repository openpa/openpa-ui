<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  ElCard, ElForm, ElFormItem, ElInput,
  ElButton, ElMessage, ElDialog, ElDivider,
  ElRadioGroup, ElRadioButton,
} from 'element-plus';
import { Icon } from '@iconify/vue';
import { useSettingsStore, type ProfileValue } from '../stores/settings';
import {
  listAgents, addAgent, removeAgent, updateAgentConfig,
  listTools, updateToolConfig, setToolEnabled, setToolFullReasoning,
  updateToolArguments,
  listLLMProviders, getProviderModels,
  type RemoteAgentInfo, type ToolStatus, type LLMProvider,
} from '../services/configApi';
import type { JsonSchema } from '../services/agentApi';
import { getAuthUrl, unlinkAgent, reconnectAgent } from '../services/agentApi';
import { useLLMModels } from '../composables/useLLMModels';
import ItemCardHeader from '../components/shared/ItemCardHeader.vue';
import ToolVariablesForm from '../components/shared/ToolVariablesForm.vue';
import ToolArgumentsForm from '../components/shared/ToolArgumentsForm.vue';
import LLMParametersForm from '../components/shared/LLMParametersForm.vue';

const props = defineProps<{ profile: string }>();
const router = useRouter();
const settingsStore = useSettingsStore();
const { rebuildModelList, getFilteredModels, getReasoningOptions } = useLLMModels();

// ── Unified item type ──
interface UnifiedItem {
  name: string;             // legacy: stable identifier (now == tool_id for builtin/skill)
  displayName: string;      // human-readable name shown on the card
  kind: 'builtin' | 'skill' | 'mcp-remote' | 'a2a-remote';

  toolName: string | null;  // tool_id used by /api/tools/{tool_id} endpoints
  toolConfigFields: Record<string, { description: string; type: string; secret: boolean; configured: boolean }>;
  toolConfigValues: Record<string, string>;
  toolConfigured: boolean;

  agentName: string;
  description: string;
  url: string;
  systemPrompt: string;
  llmProvider: string;
  llmModel: string;
  reasoningEffort: string;
  fullReasoning: boolean;
  enabled: boolean;

  showAuthenticate: boolean;
  showUnlink: boolean;
  badgeClass: string;
  statusText: string;
  connectionError: string | null;
  hasAgent: boolean;
  agentType: string | null;

  argumentsSchema: JsonSchema | null;
  argValues: Record<string, ProfileValue>;

  expanded: boolean;
  saving: boolean;
  /** Built-in tools only: false until a child LLM is bound (post-setup). */
  llmBound: boolean;
}

// ── Data ──
const items = ref<UnifiedItem[]>([]);
const llmProviders = ref<LLMProvider[]>([]);
const loading = ref(false);

// Add agent dialog
const showAddDialog = ref(false);
const addForm = ref({
  url: '',
  type: 'mcp' as 'mcp' | 'a2a',
  inputMode: 'url' as 'url' | 'json',
  jsonConfig: '',
  description: '',
  system_prompt: '',
  llm_provider: '',
  llm_model: '',
  reasoning_effort: '',
});
const adding = ref(false);
const jsonConfigError = ref('');

// Categorized items -- driven by tool_type, not by agent_type
const builtinItems = computed(() => items.value.filter(i => i.kind === 'builtin'));
const skillItems = computed(() => items.value.filter(i => i.kind === 'skill'));
const mcpRemoteItems = computed(() => items.value.filter(i => i.kind === 'mcp-remote'));
const a2aRemoteItems = computed(() => items.value.filter(i => i.kind === 'a2a-remote'));

// Listen for auth completion from the OAuth callback tab
function handleAuthMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === 'a2a-auth-complete') {
    reloadAll();
    ElMessage.success('Agent linked successfully');
  }
}

onMounted(async () => {
  window.addEventListener('message', handleAuthMessage);
  loading.value = true;
  try {
    const [agentRes, toolRes, provRes] = await Promise.all([
      listAgents(settingsStore.agentUrl, props.profile),
      listTools(settingsStore.agentUrl, settingsStore.authToken),
      listLLMProviders(settingsStore.agentUrl, settingsStore.authToken),
    ]);

    llmProviders.value = provRes.providers;

    // Load models for all providers using composable
    const providersWithModels: { name: string; display_name: string; models: any[] }[] = [];
    for (const p of provRes.providers) {
      try {
        const modelRes = await getProviderModels(settingsStore.agentUrl, settingsStore.authToken, p.name);
        providersWithModels.push({ name: p.name, display_name: p.display_name, models: modelRes.models });
      } catch {
        providersWithModels.push({ name: p.name, display_name: p.display_name, models: [] });
      }
    }
    rebuildModelList(providersWithModels);

    buildUnifiedItems(agentRes.agents, toolRes.tools);
  } catch (e) {
    ElMessage.error('Failed to load agents and tools');
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener('message', handleAuthMessage);
});

function getDefaultForType(type: string): ProfileValue {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  return '';
}

function initArgValues(schema: JsonSchema | null, storedValues?: Record<string, unknown> | null): Record<string, ProfileValue> {
  if (!schema || !schema.properties) return {};
  const stored = storedValues || {};
  const values: Record<string, ProfileValue> = {};
  for (const [propName, propDef] of Object.entries(schema.properties)) {
    values[propName] = (stored[propName] as ProfileValue) ?? getDefaultForType(propDef.type);
  }
  return values;
}

function buildUnifiedItems(agents: RemoteAgentInfo[], tools: ToolStatus[]) {
  const result: UnifiedItem[] = [];
  // Remote a2a/mcp tools come from /api/agents below -- skip them in the
  // tools list to avoid duplicates. /api/tools now returns {builtin, skill,
  // a2a, mcp} (intrinsic is filtered server-side).
  const localTools = tools.filter(t => t.tool_type === 'builtin' || t.tool_type === 'skill');

  for (const tool of localTools) {
    const isSkill = tool.tool_type === 'skill';
    const llmCfg = (tool.config?.llm ?? {}) as Record<string, unknown>;
    const metaCfg = (tool.config?.meta ?? {}) as Record<string, string>;
    const schema = (tool.arguments_schema as JsonSchema | null) ?? null;

    result.push({
      name: tool.tool_id,
      displayName: tool.name,
      kind: isSkill ? 'skill' : 'builtin',
      toolName: tool.tool_id,
      toolConfigFields: { ...(tool.required_fields ?? {}) },
      toolConfigValues: { ...(tool.config?.variables ?? {}) },
      toolConfigured: tool.configured,
      agentName: tool.tool_id,
      description: tool.description || metaCfg.description || '',
      url: tool.url || '',
      systemPrompt: (metaCfg.system_prompt as string) || '',
      llmProvider: (llmCfg.llm_provider as string) || '',
      llmModel: (llmCfg.llm_model as string) || '',
      reasoningEffort: (llmCfg.reasoning_effort as string) || '',
      fullReasoning: !!tool.full_reasoning,
      enabled: tool.enabled,
      connectionError: tool.connection_error ?? null,
      hasAgent: !isSkill,  // skills have no MCP/A2A backing agent
      agentType: isSkill ? 'skill' : 'mcp',  // built-in tools dispatch via the MCP-style adapter path
      showAuthenticate: false,
      showUnlink: false,
      badgeClass: '',
      statusText: '',
      argumentsSchema: schema,
      argValues: initArgValues(schema, tool.config?.arguments),
      expanded: false,
      saving: false,
      // Skills don't have a child LLM; treat them as bound.
      llmBound: isSkill ? true : (tool.llm_bound ?? true),
    });
  }

  // Remote agents -- only profile-owned/visible a2a + mcp from /api/agents
  const remoteAgents = agents;

  for (const agent of remoteAgents.filter(a => a.agent_type === 'mcp')) {
    const schema = (agent.arguments_schema as JsonSchema | null) ?? null;
    result.push({
      name: agent.tool_id,
      displayName: agent.name,
      kind: 'mcp-remote',
      toolName: agent.tool_id,
      toolConfigFields: {},
      toolConfigValues: {},
      toolConfigured: true,
      agentName: agent.tool_id,
      description: agent.description || '',
      url: agent.url,
      // Per-server LLM/system_prompt overrides are loaded on demand via /api/agents/{tool_id}/config
      systemPrompt: '',
      llmProvider: '',
      llmModel: '',
      reasoningEffort: '',
      fullReasoning: false,
      enabled: agent.enabled,
      connectionError: agent.connection_error,
      hasAgent: true,
      agentType: 'mcp',
      showAuthenticate: agent.show_authenticate,
      showUnlink: agent.show_unlink,
      badgeClass: agent.badge_class,
      statusText: agent.status_text,
      argumentsSchema: schema,
      argValues: initArgValues(schema),
      expanded: false,
      saving: false,
      llmBound: true,
    });
  }

  for (const agent of remoteAgents.filter(a => a.agent_type === 'a2a')) {
    const schema = (agent.arguments_schema as JsonSchema | null) ?? null;
    result.push({
      name: agent.tool_id,
      displayName: agent.name,
      kind: 'a2a-remote',
      toolName: agent.tool_id,
      toolConfigFields: {},
      toolConfigValues: {},
      toolConfigured: true,
      agentName: agent.tool_id,
      description: agent.description || '',
      url: agent.url,
      systemPrompt: '',
      llmProvider: '',
      llmModel: '',
      reasoningEffort: '',
      fullReasoning: false,
      enabled: agent.enabled,
      connectionError: agent.connection_error,
      hasAgent: true,
      agentType: 'a2a',
      showAuthenticate: agent.show_authenticate,
      showUnlink: agent.show_unlink,
      badgeClass: agent.badge_class,
      statusText: agent.status_text,
      argumentsSchema: schema,
      argValues: initArgValues(schema),
      expanded: false,
      saving: false,
      llmBound: true,
    });
  }

  items.value = result;
}

// ── Status tag helpers ──
function getBuiltinStatusTag(item: UnifiedItem) {
  if (!item.llmBound) return { label: 'Setup required', type: 'warning' as const };
  if (item.toolConfigured && item.enabled) return { label: 'Active', type: 'success' as const };
  if (!item.toolConfigured) return { label: 'Needs Config', type: 'warning' as const };
  return { label: 'Disabled', type: 'info' as const };
}

function getRemoteStatusTag(item: UnifiedItem) {
  if (item.connectionError) return { label: 'Connection Error', type: 'danger' as const };
  const type = item.badgeClass === 'badge-success' ? 'success' as const
    : item.badgeClass === 'badge-warning' ? 'warning' as const
    : 'danger' as const;
  return { label: item.statusText, type };
}

// ── Actions ──
async function saveItemConfig(item: UnifiedItem) {
  item.saving = true;
  try {
    if (item.toolName && Object.keys(item.toolConfigValues).length > 0) {
      await updateToolConfig(settingsStore.agentUrl, settingsStore.authToken, item.toolName, item.toolConfigValues);
    }

    if (item.toolName && item.agentType !== 'skill') {
      await setToolFullReasoning(settingsStore.agentUrl, settingsStore.authToken, item.toolName, item.fullReasoning);
    }

    if (item.kind !== 'a2a-remote' && item.hasAgent && item.agentType !== 'skill') {
      await updateAgentConfig(settingsStore.agentUrl, item.agentName, {
        profile: props.profile,
        description: item.description || null,
        system_prompt: item.systemPrompt || null,
        llm_provider: item.llmProvider || null,
        llm_model: item.llmModel || null,
        reasoning_effort: getReasoningOptions(item.llmModel).length > 0 ? (item.reasoningEffort || null) : null,
        full_reasoning: item.kind === 'mcp-remote' ? item.fullReasoning : undefined,
      });
    }

    if (item.argumentsSchema && Object.keys(item.argValues).length > 0) {
      const configName = item.toolName || item.agentName;
      await updateToolArguments(settingsStore.agentUrl, settingsStore.authToken, configName, { ...item.argValues });
    }

    ElMessage.success(`${item.displayName} configuration saved`);
    await reloadAll();
  } catch (e) {
    ElMessage.error(`Failed to save: ${e instanceof Error ? e.message : 'Unknown error'}`);
  } finally {
    item.saving = false;
  }
}

function resetLLMDefaults(item: UnifiedItem) {
  item.description = '';
  item.systemPrompt = '';
  item.llmProvider = '';
  item.llmModel = '';
  item.reasoningEffort = '';
  item.fullReasoning = false;
}

async function toggleItemEnabled(item: UnifiedItem, value: boolean) {
  // Single source of truth: /api/tools/{tool_id}/enabled writes the
  // profile_tools row for any tool type (builtin / skill / a2a / mcp).
  // The legacy /api/agents/{tool_id}/enabled endpoint resolves to the same
  // backend handler -- no need to call it twice.
  item.enabled = value;
  try {
    await setToolEnabled(
      settingsStore.agentUrl,
      settingsStore.authToken,
      item.toolName ?? item.name,
      item.enabled,
    );
  } catch (e) {
    item.enabled = !item.enabled;
    ElMessage.error(e instanceof Error ? e.message : 'Failed to toggle');
  }
}

async function handleAuthenticate(item: UnifiedItem) {
  try {
    const url = await getAuthUrl(settingsStore.agentUrl, item.agentName, props.profile);
    window.open(url, '_blank');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'Failed to get auth URL');
  }
}

async function handleUnlink(item: UnifiedItem) {
  try {
    await unlinkAgent(settingsStore.agentUrl, item.agentName, props.profile);
    ElMessage.success(`Unlinked ${item.name}`);
    await reloadAll();
  } catch (e) {
    ElMessage.error('Failed to unlink');
  }
}

async function handleReconnect(item: UnifiedItem) {
  try {
    await reconnectAgent(settingsStore.agentUrl, item.agentName, props.profile);
    ElMessage.success(`Reconnected ${item.name}`);
    await reloadAll();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'Failed to reconnect');
    await reloadAll();
  }
}

async function handleRemoveAgent(item: UnifiedItem) {
  try {
    await removeAgent(settingsStore.agentUrl, item.agentName, props.profile);
    ElMessage.success(`Removed ${item.name}`);
    await reloadAll();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'Failed to remove agent');
  }
}

function openAddDialog(type: 'mcp' | 'a2a') {
  addForm.value = {
    url: '', type, inputMode: 'url', jsonConfig: '',
    description: '', system_prompt: '', llm_provider: '', llm_model: '', reasoning_effort: '',
  };
  jsonConfigError.value = '';
  showAddDialog.value = true;
}

async function handleAddAgent() {
  const isMcpJson = addForm.value.type === 'mcp' && addForm.value.inputMode === 'json';

  if (isMcpJson) {
    if (!addForm.value.jsonConfig.trim()) return;
    try {
      JSON.parse(addForm.value.jsonConfig);
      jsonConfigError.value = '';
    } catch {
      jsonConfigError.value = 'Invalid JSON format';
      return;
    }
  } else {
    if (!addForm.value.url.trim()) return;
  }

  adding.value = true;
  try {
    const config: { type: string; profile: string; url?: string; json_config?: string; description?: string; system_prompt?: string; llm_provider?: string; llm_model?: string; reasoning_effort?: string } = {
      type: addForm.value.type,
      profile: props.profile,
    };

    if (isMcpJson) {
      config.json_config = addForm.value.jsonConfig.trim();
    } else {
      config.url = addForm.value.url.trim();
    }

    if (addForm.value.type === 'mcp') {
      if (addForm.value.description) config.description = addForm.value.description;
      if (addForm.value.system_prompt) config.system_prompt = addForm.value.system_prompt;
      if (addForm.value.llm_provider) config.llm_provider = addForm.value.llm_provider;
      if (addForm.value.llm_model) config.llm_model = addForm.value.llm_model;
      if (addForm.value.reasoning_effort) config.reasoning_effort = addForm.value.reasoning_effort;
    }

    await addAgent(settingsStore.agentUrl, config);
    ElMessage.success('Agent added successfully');
    showAddDialog.value = false;
    await reloadAll();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'Failed to add agent');
  } finally {
    adding.value = false;
  }
}

async function reloadAll() {
  try {
    const [agentRes, toolRes] = await Promise.all([
      listAgents(settingsStore.agentUrl, props.profile),
      listTools(settingsStore.agentUrl, settingsStore.authToken),
    ]);
    buildUnifiedItems(agentRes.agents, toolRes.tools);
  } catch { /* ignore */ }
}

function goBack() { router.push(`/${props.profile}/settings`); }
</script>

<template>
  <div class="agents-tools-page">
    <div class="page-container">
      <div class="page-header">
        <button class="back-btn" @click="goBack">
          <Icon icon="mdi:arrow-left" /> Back to Settings
        </button>
        <h1 class="page-title">Tools & Skills</h1>
      </div>

      <div v-if="loading" class="loading-state">Loading...</div>

      <template v-else>
        <!-- Section 1: Built-in Tools -->
        <div class="section" v-if="builtinItems.length > 0">
          <h2 class="section-title">
            <Icon icon="mdi:toolbox" class="section-icon" /> Built-in Tools
          </h2>

          <div class="items-list">
            <ElCard v-for="item in builtinItems" :key="item.name" class="item-card" shadow="hover">
              <ItemCardHeader
                :name="item.displayName"
                :status-tag="getBuiltinStatusTag(item)"
                :expanded="item.expanded"
                :enabled="item.enabled"
                :show-authenticate="item.showAuthenticate"
                :show-unlink="item.showUnlink"
                @toggle-expand="item.expanded = !item.expanded"
                @update:enabled="toggleItemEnabled(item, $event)"
                @authenticate="handleAuthenticate(item)"
                @unlink="handleUnlink(item)"
              />

              <div v-if="item.expanded" class="item-config">
                <div v-if="Object.keys(item.toolConfigFields).length > 0" class="config-section">
                  <ToolVariablesForm
                    :fields="item.toolConfigFields"
                    :values="item.toolConfigValues"
                    @update:values="item.toolConfigValues = $event"
                  />
                </div>

                <div v-if="item.agentType !== 'skill'" class="config-section">
                  <h4 class="config-section-title">LLM Parameters</h4>
                  <LLMParametersForm
                    v-model:description="item.description"
                    v-model:system-prompt="item.systemPrompt"
                    v-model:llm-provider="item.llmProvider"
                    v-model:llm-model="item.llmModel"
                    v-model:reasoning-effort="item.reasoningEffort"
                    v-model:full-reasoning="item.fullReasoning"
                    :providers="llmProviders"
                    :get-filtered-models="getFilteredModels"
                    :get-reasoning-options="getReasoningOptions"
                  />
                </div>

                <div v-if="item.argumentsSchema && Object.keys(item.argumentsSchema.properties).length > 0" class="config-section">
                  <ToolArgumentsForm
                    :schema="item.argumentsSchema"
                    :arg-values="item.argValues"
                    @update:arg-values="item.argValues = $event"
                  />
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                  <ElButton type="primary" size="small" :loading="item.saving" @click="saveItemConfig(item)">Save</ElButton>
                  <ElButton size="small" @click="resetLLMDefaults(item)">Reset All to Default</ElButton>
                </div>
              </div>
            </ElCard>
          </div>
        </div>

        <ElDivider />

        <!-- Section 2: Skills -->
        <div class="section" v-if="skillItems.length > 0">
          <h2 class="section-title">
            <Icon icon="mdi:creation" class="section-icon" /> Skills
          </h2>

          <div class="items-list">
            <ElCard v-for="item in skillItems" :key="item.name" class="item-card" shadow="hover">
              <ItemCardHeader
                :name="item.displayName"
                :status-tag="getBuiltinStatusTag(item)"
                :expanded="item.expanded"
                :enabled="item.enabled"
                :show-authenticate="item.showAuthenticate"
                :show-unlink="item.showUnlink"
                @toggle-expand="item.expanded = !item.expanded"
                @update:enabled="toggleItemEnabled(item, $event)"
                @authenticate="handleAuthenticate(item)"
                @unlink="handleUnlink(item)"
              />

              <div v-if="item.expanded" class="item-config">
                <p v-if="item.description" class="item-desc skill-description">{{ item.description }}</p>

                <div v-if="Object.keys(item.toolConfigFields).length > 0" class="config-section">
                  <ToolVariablesForm
                    title="Skill Variables"
                    :fields="item.toolConfigFields"
                    :values="item.toolConfigValues"
                    @update:values="item.toolConfigValues = $event"
                  />
                  <ElButton type="primary" size="small" :loading="item.saving" @click="saveItemConfig(item)">Save</ElButton>
                </div>
              </div>
            </ElCard>
          </div>
        </div>

        <ElDivider />

        <!-- Section 3: MCP Server Remote -->
        <div class="section">
          <h2 class="section-title">
            <Icon icon="mdi:server-network" class="section-icon" /> MCP Server Remote
          </h2>

          <div v-if="mcpRemoteItems.length === 0" class="empty-state">No remote MCP servers configured.</div>

          <div v-else class="items-list">
            <ElCard v-for="item in mcpRemoteItems" :key="item.name" class="item-card" :class="{ 'item-card-error': !!item.connectionError }" shadow="hover">
              <ItemCardHeader
                :name="item.name"
                :status-tag="getRemoteStatusTag(item)"
                :expanded="item.expanded"
                :enabled="item.enabled"
                :show-authenticate="item.showAuthenticate && !item.connectionError"
                :show-unlink="item.showUnlink && !item.connectionError"
                :show-reconnect="!!item.connectionError"
                :show-remove="true"
                :remove-name="item.name"
                @toggle-expand="item.expanded = !item.expanded"
                @update:enabled="toggleItemEnabled(item, $event)"
                @authenticate="handleAuthenticate(item)"
                @unlink="handleUnlink(item)"
                @reconnect="handleReconnect(item)"
                @remove="handleRemoveAgent(item)"
              />
              <p class="item-url">{{ item.url }}</p>
              <p v-if="item.connectionError" class="item-error-msg"><Icon icon="mdi:alert-circle-outline" /> {{ item.connectionError }}</p>

              <div v-if="item.expanded" class="item-config">
                <div class="config-section">
                  <h4 class="config-section-title">LLM Parameters</h4>
                  <LLMParametersForm
                    v-model:description="item.description"
                    v-model:system-prompt="item.systemPrompt"
                    v-model:llm-provider="item.llmProvider"
                    v-model:llm-model="item.llmModel"
                    v-model:reasoning-effort="item.reasoningEffort"
                    v-model:full-reasoning="item.fullReasoning"
                    :providers="llmProviders"
                    :get-filtered-models="getFilteredModels"
                    :get-reasoning-options="getReasoningOptions"
                  />
                </div>

                <div v-if="item.argumentsSchema && Object.keys(item.argumentsSchema.properties).length > 0" class="config-section">
                  <ToolArgumentsForm
                    :schema="item.argumentsSchema"
                    :arg-values="item.argValues"
                    @update:arg-values="item.argValues = $event"
                  />
                </div>

                <div style="display: flex; align-items: center; gap: 8px;">
                  <ElButton type="primary" size="small" :loading="item.saving" @click="saveItemConfig(item)">Save</ElButton>
                  <ElButton size="small" @click="resetLLMDefaults(item)">Reset All to Default</ElButton>
                </div>
              </div>
            </ElCard>
          </div>

          <ElButton type="primary" class="add-btn" @click="openAddDialog('mcp')">
            <Icon icon="mdi:plus" /> Add MCP Server
          </ElButton>
        </div>

        <ElDivider />

        <!-- Section 4: A2A Agent Remote -->
        <div class="section">
          <h2 class="section-title">
            <Icon icon="mdi:robot" class="section-icon" /> A2A Agent Remote
          </h2>

          <div v-if="a2aRemoteItems.length === 0" class="empty-state">No A2A agents configured.</div>

          <div v-else class="items-list">
            <ElCard v-for="item in a2aRemoteItems" :key="item.name" class="item-card" :class="{ 'item-card-error': !!item.connectionError }" shadow="hover">
              <ItemCardHeader
                :name="item.name"
                :status-tag="getRemoteStatusTag(item)"
                :expanded="item.expanded"
                :enabled="item.enabled"
                :show-authenticate="item.showAuthenticate && !item.connectionError"
                :show-unlink="item.showUnlink && !item.connectionError"
                :show-reconnect="!!item.connectionError"
                :show-remove="true"
                :remove-name="item.name"
                @toggle-expand="item.expanded = !item.expanded"
                @update:enabled="toggleItemEnabled(item, $event)"
                @authenticate="handleAuthenticate(item)"
                @unlink="handleUnlink(item)"
                @reconnect="handleReconnect(item)"
                @remove="handleRemoveAgent(item)"
              />
              <p class="item-url">{{ item.url }}</p>
              <p v-if="item.connectionError" class="item-error-msg"><Icon icon="mdi:alert-circle-outline" /> {{ item.connectionError }}</p>
              <p v-else class="item-desc">{{ item.description }}</p>

              <div v-if="item.expanded" class="item-config">
                <div v-if="item.argumentsSchema && Object.keys(item.argumentsSchema.properties).length > 0" class="config-section">
                  <ToolArgumentsForm
                    :schema="item.argumentsSchema"
                    :arg-values="item.argValues"
                    @update:arg-values="item.argValues = $event"
                  />
                </div>

                <div v-else class="empty-args">No arguments required for this agent.</div>

                <ElButton type="primary" size="small" :loading="item.saving" @click="saveItemConfig(item)">Save</ElButton>
              </div>
            </ElCard>
          </div>

          <ElButton type="primary" class="add-btn" @click="openAddDialog('a2a')">
            <Icon icon="mdi:plus" /> Add A2A Agent
          </ElButton>
        </div>
      </template>
    </div>

    <!-- Add Agent Dialog -->
    <ElDialog v-model="showAddDialog" :title="addForm.type === 'mcp' ? 'Add MCP Server' : 'Add A2A Agent'" width="520px">
      <ElForm label-position="top">
        <!-- Input mode toggle (MCP only) -->
        <template v-if="addForm.type === 'mcp'">
          <ElFormItem>
            <ElRadioGroup v-model="addForm.inputMode" size="small">
              <ElRadioButton value="url">URL</ElRadioButton>
              <ElRadioButton value="json">JSON Config</ElRadioButton>
            </ElRadioGroup>
          </ElFormItem>
        </template>

        <!-- URL mode -->
        <template v-if="addForm.inputMode === 'url' || addForm.type === 'a2a'">
          <ElFormItem label="URL" required>
            <ElInput v-model="addForm.url" placeholder="http://localhost:9000/mcp" />
          </ElFormItem>
        </template>

        <!-- JSON config mode (MCP only) -->
        <template v-if="addForm.type === 'mcp' && addForm.inputMode === 'json'">
          <ElFormItem label="JSON Configuration" required :error="jsonConfigError">
            <ElInput
              v-model="addForm.jsonConfig"
              type="textarea"
              :rows="8"
              placeholder='{ "myServer": { "type": "stdio", "command": "npx", "args": ["-y", "@example/mcp-server"] } }'
              @input="jsonConfigError = ''"
              class="json-config-input"
            />
            <div class="json-config-hint">
              Supports <code>stdio</code> and <code>http</code> transport types.
              Use the VS Code MCP server config format.
            </div>
          </ElFormItem>
        </template>

        <template v-if="addForm.type === 'mcp'">
          <LLMParametersForm
            v-model:description="addForm.description"
            v-model:system-prompt="addForm.system_prompt"
            v-model:llm-provider="addForm.llm_provider"
            v-model:llm-model="addForm.llm_model"
            v-model:reasoning-effort="addForm.reasoning_effort"
            :full-reasoning="false"
            :providers="llmProviders"
            :get-filtered-models="getFilteredModels"
            :get-reasoning-options="getReasoningOptions"
            :show-full-reasoning="false"
          />
        </template>
      </ElForm>
      <template #footer>
        <ElButton @click="showAddDialog = false">Cancel</ElButton>
        <ElButton
          type="primary"
          :loading="adding"
          @click="handleAddAgent"
          :disabled="addForm.type === 'mcp' && addForm.inputMode === 'json'
            ? !addForm.jsonConfig.trim()
            : !addForm.url.trim()"
        >Add</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.agents-tools-page {
  width: 100%; height: 100%; overflow-y: auto; background: var(--bg-color);
  padding: 24px; box-sizing: border-box;
}
.page-container { max-width: 800px; margin: 0 auto; }
.page-header { margin-bottom: 24px; }
.back-btn {
  display: flex; align-items: center; gap: 6px; background: none;
  border: none; color: var(--text-secondary); cursor: pointer;
  font-size: 0.875rem; padding: 4px 0; margin-bottom: 12px;
}
.back-btn:hover { color: var(--primary-color); }
.page-title { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin: 0; }
.loading-state { text-align: center; padding: 40px; color: var(--text-secondary); }

.section { margin-bottom: 8px; }
.section-title {
  font-size: 1.1rem; font-weight: 600; color: var(--text-primary);
  margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;
}
.section-icon { font-size: 20px; color: var(--primary-color); }

.items-list { display: flex; flex-direction: column; gap: 10px; }

.item-card { background: var(--surface-color); }
.item-card-error { border-color: var(--el-color-danger-light-5, #fab6b6); }
.item-url { color: var(--text-tertiary); font-size: 0.75rem; font-family: monospace; margin: 4px 0 0 0; }
.item-desc { color: var(--text-secondary); font-size: 0.8rem; margin: 2px 0 0 0; }
.skill-description { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color, #e4e7ed); }
.item-error-msg { color: var(--el-color-danger, #f56c6c); font-size: 0.75rem; margin: 4px 0 0 0; display: flex; align-items: center; gap: 4px; }

.item-config {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color, #e4e7ed);
}

.config-section {
  margin-bottom: 12px;
}
.config-section + .config-section {
  padding-top: 12px;
  border-top: 1px dashed var(--border-color, #e4e7ed);
}
.config-section-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin: 0 0 8px 0;
}

.empty-args { color: var(--text-tertiary); font-size: 0.8rem; padding: 4px 0 12px 0; }
.empty-state { color: var(--text-tertiary); font-size: 0.85rem; padding: 16px 0; }
.add-btn { margin-top: 8px; }

.json-config-input :deep(textarea) { font-family: monospace; font-size: 0.8rem; }
.json-config-hint {
  font-size: 0.75rem; color: var(--text-tertiary); margin-top: 4px; line-height: 1.4;
}
.json-config-hint code {
  background: var(--el-fill-color-light, #f5f7fa); padding: 1px 4px; border-radius: 3px;
  font-size: 0.7rem;
}
</style>
