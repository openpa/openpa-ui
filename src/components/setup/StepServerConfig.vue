<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { ElForm, ElFormItem, ElInput } from 'element-plus';

const props = defineProps<{
  config: Record<string, string>;
}>();

const emit = defineEmits<{
  update: [config: Record<string, string>];
}>();

const form = ref({
  service_name: props.config.service_name || 'openpa-agent',
  agent_name: props.config.agent_name || 'OPENPA Agent',
  working_dir: props.config.working_dir || '~/.openpa',
  sqlite_db_path: props.config.sqlite_db_path || 'openpa.db',
});

watch(form, (val) => {
  emit('update', { ...val });
}, { deep: true });

onMounted(() => {
  emit('update', { ...form.value });
});
</script>

<template>
  <div class="step-server-config">
    <h3 class="step-title">Server Configuration</h3>
    <p class="step-description">
      Configure your OpenPA server identity. Host and port are managed via the <code>.env</code> file on the server.
    </p>

    <ElForm label-position="top" class="config-form">
      <ElFormItem label="Service Name">
        <ElInput v-model="form.service_name" placeholder="openpa-agent" />
      </ElFormItem>
      <ElFormItem label="Agent Display Name">
        <ElInput v-model="form.agent_name" placeholder="OPENPA Agent" />
      </ElFormItem>
      <ElFormItem label="Working Directory">
        <ElInput v-model="form.working_dir" placeholder="~/.openpa" />
        <div class="field-hint">Base directory for profiles, storage, and data files.</div>
      </ElFormItem>
      <ElFormItem label="Database Name">
        <ElInput v-model="form.sqlite_db_path" placeholder="openpa.db" />
        <div class="field-hint">SQLite database filename, stored inside the working directory.</div>
      </ElFormItem>
    </ElForm>

    <div class="info-box">
      <strong>Note:</strong> Server host, port, and URL are configured in the <code>.env</code> file on the server machine.
      These cannot be changed from the UI as they require a server restart.
    </div>
  </div>
</template>

<style scoped>
.step-server-config {
  padding: 8px 0;
}

.step-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.step-description {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0 0 24px 0;
  line-height: 1.5;
}

.config-form {
  max-width: 480px;
}

.field-hint {
  margin-top: 4px;
  font-size: 0.775rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.info-box {
  margin-top: 24px;
  padding: 12px 16px;
  background: var(--hover-bg);
  border-radius: 8px;
  font-size: 0.825rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.info-box code {
  background: var(--surface-color);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.8rem;
}
</style>
