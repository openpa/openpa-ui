<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElSteps, ElStep, ElButton, ElMessage } from 'element-plus';
import { useSettingsStore } from '../stores/settings';
import { useConfigStore } from '../stores/config';
import StepServerConfig from '../components/setup/StepServerConfig.vue';
import StepLLMConfig from '../components/setup/StepLLMConfig.vue';
import StepToolConfig from '../components/setup/StepToolConfig.vue';
import StepProfileCreate from '../components/setup/StepProfileCreate.vue';
import { completeSetup, checkSetupStatus } from '../services/configApi';

const props = defineProps<{
  profile?: string;
}>();

const router = useRouter();
const settingsStore = useSettingsStore();
const configStore = useConfigStore();

const currentStep = ref(0);
const submitting = ref(false);

// Determine if this is the first setup or a profile-specific setup
const profileName = computed(() => props.profile || 'admin');
const isFirstSetup = ref(true);
const generatedToken = ref('');
const checkingStatus = ref(true);

// Collected config from each step
const serverConfig = ref<Record<string, string>>({});
const llmConfig = ref<Record<string, string>>({});
const toolConfigs = ref<Record<string, Record<string, string>>>({});
const agentConfigs = ref<Record<string, Record<string, string>>>({});

// Step definitions depend on whether this is the first setup
// First setup (admin): Server → LLM → Tools → Complete
// Profile setup:       LLM → Tools → Complete  (no server config)
const steps = computed(() => {
  if (isFirstSetup.value) {
    return [
      { key: 'server', title: 'Server', description: 'General settings' },
      { key: 'llm', title: 'LLM Providers', description: 'Configure AI models' },
      { key: 'tools', title: 'Tools', description: 'Configure built-in tools' },
      { key: 'complete', title: 'Complete', description: 'Generate token' },
    ];
  }
  return [
    { key: 'llm', title: 'LLM Providers', description: 'Configure AI models' },
    { key: 'tools', title: 'Tools', description: 'Configure built-in tools' },
    { key: 'complete', title: 'Complete', description: 'Create profile' },
  ];
});

// The key of the currently active step
const currentStepKey = computed(() => {
  return steps.value[currentStep.value]?.key || '';
});

// Whether we're on the final step
const isLastStep = computed(() => currentStep.value === steps.value.length - 1);

onMounted(async () => {
  checkingStatus.value = true;
  try {
    const status = await checkSetupStatus(settingsStore.agentUrl, profileName.value);
    isFirstSetup.value = !status.setup_complete;

    // Clear stale localStorage from any previous installation when re-running first setup
    if (isFirstSetup.value) {
      for (const p of settingsStore.getLoggedInProfiles()) {
        settingsStore.removeTokenForProfile(p);
      }
    }

    // If setup is already complete and this is /setup (no profile), redirect to admin login
    if (status.setup_complete && !props.profile) {
      router.replace('/login/admin');
      return;
    }

    // If profile already exists, redirect to login
    if (status.profile_exists && props.profile) {
      router.replace(`/login/${props.profile}`);
      return;
    }
  } catch {
    // Server unreachable - assume first setup
    isFirstSetup.value = true;
  } finally {
    checkingStatus.value = false;
  }
});

function handleServerConfigUpdate(config: Record<string, string>) {
  serverConfig.value = config;
}

function handleLLMConfigUpdate(config: Record<string, string>) {
  llmConfig.value = config;
}

function handleToolConfigsUpdate(configs: Record<string, Record<string, string>>) {
  toolConfigs.value = configs;
}

function handleAgentConfigsUpdate(configs: Record<string, Record<string, string>>) {
  agentConfigs.value = configs;
}

function handleNext() {
  if (currentStep.value < steps.value.length - 1) {
    currentStep.value++;
  }
}

function handlePrev() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

async function handleCompleteSetup() {
  submitting.value = true;
  try {
    const config: Record<string, unknown> = { profile: profileName.value };

    if (isFirstSetup.value) {
      config.server_config = serverConfig.value;
    }
    // Always send LLM and tool configs (both first setup and profile setup)
    config.llm_config = llmConfig.value;
    config.tool_configs = toolConfigs.value;
    if (Object.keys(agentConfigs.value).length > 0) {
      config.agent_configs = agentConfigs.value;
    }

    const result = await completeSetup(settingsStore.agentUrl, config as any);
    generatedToken.value = result.token;

    ElMessage.success('Setup completed! Copy your token below.');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'Setup failed');
  } finally {
    submitting.value = false;
  }
}

async function handleFinish() {
  if (!generatedToken.value) {
    ElMessage.warning('Please complete setup first.');
    return;
  }

  // Save token per-profile and activate, then redirect to chat
  settingsStore.setTokenForProfile(profileName.value, generatedToken.value);
  settingsStore.activateProfile(profileName.value);
  configStore.setupComplete = true;
  router.push(`/${profileName.value}`);
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(generatedToken.value);
    ElMessage.success('Token copied to clipboard!');
  } catch {
    ElMessage.error('Failed to copy token');
  }
}
</script>

<template>
  <div class="setup-wizard">
    <div v-if="checkingStatus" class="loading-state">Checking setup status...</div>
    <div v-else class="setup-container">
      <div class="setup-header">
        <h1 class="setup-title">
          {{ isFirstSetup ? 'Welcome to OpenPA' : `Setup Profile: ${profileName}` }}
        </h1>
        <p class="setup-subtitle">
          {{ isFirstSetup ? "Let's set up your personal assistant" : 'Configure your new profile' }}
        </p>
      </div>

      <ElSteps :active="currentStep" finish-status="success" align-center class="setup-steps">
        <ElStep v-for="step in steps" :key="step.key" :title="step.title" :description="step.description" />
      </ElSteps>

      <div class="step-content">
        <StepServerConfig
          v-if="currentStepKey === 'server'"
          :config="serverConfig"
          @update="handleServerConfigUpdate"
        />
        <StepLLMConfig
          v-else-if="currentStepKey === 'llm'"
          :agent-url="settingsStore.agentUrl"
          :config="llmConfig"
          @update="handleLLMConfigUpdate"
        />
        <StepToolConfig
          v-else-if="currentStepKey === 'tools'"
          :agent-url="settingsStore.agentUrl"
          :configs="toolConfigs"
          :profile="profileName"
          :is-first-setup="isFirstSetup"
          @update="handleToolConfigsUpdate"
          @update:agent-configs="handleAgentConfigsUpdate"
        />
        <StepProfileCreate
          v-else-if="currentStepKey === 'complete'"
          :token="generatedToken"
          :submitting="submitting"
          :profile-name="profileName"
          @generate="handleCompleteSetup"
          @copy="copyToken"
        />
      </div>

      <div class="step-actions">
        <ElButton v-if="currentStep > 0 && !generatedToken" @click="handlePrev">Previous</ElButton>
        <div class="spacer"></div>
        <ElButton
          v-if="!isLastStep"
          type="primary"
          @click="handleNext"
        >
          Next
        </ElButton>
        <ElButton
          v-else-if="!generatedToken"
          type="primary"
          :loading="submitting"
          @click="handleCompleteSetup"
        >
          {{ isFirstSetup ? 'Complete Setup' : `Create Profile "${profileName}"` }}
        </ElButton>
        <ElButton
          v-else
          type="success"
          @click="handleFinish"
        >
          Start Using OpenPA
        </ElButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-wizard {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: safe center;
  justify-content: safe center;
  background: var(--bg-color);
  overflow-y: auto;
  padding: 24px;
  box-sizing: border-box;
}

.loading-state { color: var(--text-secondary); font-size: 0.95rem; }

.setup-container {
  width: 100%;
  max-width: 720px;
  background: var(--surface-color);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  padding: 32px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
}

.setup-header { text-align: center; margin-bottom: 32px; }
.setup-title { font-size: 1.75rem; font-weight: 700; color: var(--text-primary); margin: 0 0 8px 0; }
.setup-subtitle { font-size: 0.95rem; color: var(--text-secondary); margin: 0; }
.setup-steps { margin-bottom: 32px; }
.step-content { min-height: 300px; margin-bottom: 24px; }
.step-actions {
  display: flex; align-items: center; padding-top: 16px;
  border-top: 1px solid var(--border-color);
}
.spacer { flex: 1; }
</style>
