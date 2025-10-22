<template>
  <div class="ip-optimizer-indicator" v-if="status.enabled">
    <div class="indicator-content">
      <span class="icon">🚀</span>
      <div class="text">
        <strong>IP优选已启用</strong>
        <span class="detail" v-if="status.optimizedIP">
          当前使用: {{ status.optimizedIP }}
        </span>
      </div>
      <button @click="$emit('openSettings')" class="settings-btn">
        设置
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useApiService } from '../services/api'

const apiService = useApiService()
const status = ref({
  enabled: false,
  optimizedIP: null
})

function updateStatus() {
  status.value = apiService.getIPOptimizationStatus()
}

onMounted(() => {
  updateStatus()
  setInterval(updateStatus, 30000)
})

defineEmits(['openSettings'])
</script>

<style scoped>
.ip-optimizer-indicator {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.indicator-content {
  display: flex;
  align-items: center;
  gap: 12px;
  color: white;
}

.icon {
  font-size: 24px;
}

.text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.text strong {
  font-size: 14px;
}

.detail {
  font-size: 12px;
  opacity: 0.9;
  font-family: monospace;
}

.settings-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
  font-size: 13px;
}

.settings-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
