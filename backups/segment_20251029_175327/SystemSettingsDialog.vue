<template>
  <el-dialog
    v-model="dialogVisible"
    title="系统设置"
    width="500px"
    :close-on-click-modal="false"
  >
    <el-form
      ref="formRef"
      :model="form"
      label-width="120px"
      v-loading="loading"
    >
      <el-divider content-position="left">视频清理配置</el-divider>
      
      <el-form-item label="启用自动清理">
        <el-switch v-model="form.enabled" />
      </el-form-item>
      
      <el-form-item label="保留天数">
        <el-input-number 
          v-model="form.retentionDays" 
          :min="1" 
          :max="365"
          style="width: 150px"
        />
        <div style="margin-top: 5px; color: #909399; font-size: 12px;">
          删除 {{ form.retentionDays }} 天前的视频文件
        </div>
      </el-form-item>
      
      <el-form-item label="清理时间">
        <el-tag type="info">每天 01:00 (北京时间)</el-tag>
      </el-form-item>

      <el-divider />

      <el-form-item>
        <div style="display: flex; justify-content: space-between; width: 100%; gap: 10px;">
          <el-button 
            type="warning" 
            @click="handleManualCleanup"
            :loading="cleanupLoading"
          >
            手动清理
          </el-button>
          <div style="display: flex; gap: 10px;">
            <el-button @click="handleCancel">取消</el-button>
            <el-button type="primary" @click="handleSave" :loading="saveLoading">
              保存
            </el-button>
          </div>
        </div>
      </el-form-item>
    </el-form>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { axios } from '@/utils/axios'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

const dialogVisible = ref(false)
const loading = ref(false)
const saveLoading = ref(false)
const cleanupLoading = ref(false)
const formRef = ref(null)

const form = reactive({
  enabled: true,
  retentionDays: 2
})

// 监听外部变化
watch(() => props.modelValue, (newVal) => {
  dialogVisible.value = newVal
  if (newVal) {
    fetchConfig()
  }
})

// 监听内部变化
watch(dialogVisible, (newVal) => {
  emit('update:modelValue', newVal)
})

// 获取配置
const fetchConfig = async () => {
  loading.value = true
  try {
    const response = await axios.get('/api/admin/cleanup/config')
    if (response.data && response.data.status === 'success') {
      Object.assign(form, response.data.data)
    }
  } catch (error) {
    console.error('获取清理配置失败:', error)
    ElMessage.error('获取清理配置失败')
  } finally {
    loading.value = false
  }
}

// 保存配置
const handleSave = async () => {
  saveLoading.value = true
  try {
    const response = await axios.put('/api/admin/cleanup/config', {
      enabled: form.enabled,
      retentionDays: form.retentionDays
    })
    
    if (response.data && response.data.status === 'success') {
      ElMessage.success('配置已保存')
      dialogVisible.value = false
    } else {
      ElMessage.error('保存配置失败')
    }
  } catch (error) {
    console.error('保存清理配置失败:', error)
    ElMessage.error('保存配置失败')
  } finally {
    saveLoading.value = false
  }
}

// 手动触发清理
const handleManualCleanup = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要立即执行视频清理吗？',
      '确认操作',
      {
        type: 'warning',
        confirmButtonText: '确定',
        cancelButtonText: '取消'
      }
    )
    
    cleanupLoading.value = true
    
    const response = await axios.post('/api/admin/cleanup/trigger')
    
    if (response.data && response.data.status === 'success') {
      ElMessage.success('清理任务已触发，正在后台执行')
    } else {
      ElMessage.warning(response.data?.message || '触发清理失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('手动清理失败:', error)
      ElMessage.error('触发清理失败')
    }
  } finally {
    cleanupLoading.value = false
  }
}

// 取消
const handleCancel = () => {
  dialogVisible.value = false
}
</script>

<style scoped>
.el-divider {
  margin: 15px 0;
}

.el-form-item {
  margin-bottom: 20px;
}
</style>
