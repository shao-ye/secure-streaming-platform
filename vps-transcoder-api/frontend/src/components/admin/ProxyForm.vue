<template>
  <el-dialog
    v-model="visible"
    :title="mode === 'create' ? '添加代理' : '编辑代理'"
    width="600px"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-width="100px"
    >
      <el-form-item label="代理名称" prop="name">
        <el-input
          v-model="formData.name"
          placeholder="请输入代理名称"
          maxlength="50"
        />
      </el-form-item>

      <el-form-item label="代理类型" prop="type">
        <el-select v-model="formData.type" placeholder="请选择代理类型" style="width: 100%">
          <el-option label="VLESS" value="vless" />
          <el-option label="VMess" value="vmess" />
          <el-option label="Shadowsocks" value="shadowsocks" />
          <el-option label="HTTP" value="http" />
        </el-select>
      </el-form-item>

      <el-form-item label="代理配置" prop="config">
        <el-input
          v-model="formData.config"
          type="textarea"
          :rows="4"
          placeholder="请输入代理配置URL，例如：vless://uuid@host:port?params"
        />
      </el-form-item>

      <el-form-item label="优先级" prop="priority">
        <el-input-number
          v-model="formData.priority"
          :min="1"
          :max="100"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="formData.remarks"
          placeholder="可选的备注信息"
          maxlength="200"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          {{ mode === 'create' ? '添加' : '保存' }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  mode: {
    type: String,
    default: 'create' // 'create' | 'edit'
  },
  proxyData: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'submit'])

const formRef = ref()
const submitting = ref(false)

const formData = ref({
  name: '',
  type: 'vless',
  config: '',
  priority: 1,
  remarks: ''
})

const rules = {
  name: [
    { required: true, message: '请输入代理名称', trigger: 'blur' },
    { min: 2, max: 50, message: '名称长度在 2 到 50 个字符', trigger: 'blur' }
  ],
  type: [
    { required: true, message: '请选择代理类型', trigger: 'change' }
  ],
  config: [
    { required: true, message: '请输入代理配置', trigger: 'blur' },
    { validator: validateProxyConfig, trigger: 'blur' }
  ],
  priority: [
    { required: true, message: '请设置优先级', trigger: 'blur' },
    { type: 'number', min: 1, max: 100, message: '优先级范围为 1-100', trigger: 'blur' }
  ]
}

// 代理配置验证
function validateProxyConfig(rule, value, callback) {
  if (!value) {
    callback(new Error('请输入代理配置'))
    return
  }
  
  const type = formData.value.type
  let isValid = false
  
  try {
    if (type === 'vless' && value.startsWith('vless://')) {
      isValid = true
    } else if (type === 'vmess' && value.startsWith('vmess://')) {
      isValid = true
    } else if (type === 'shadowsocks' && value.startsWith('ss://')) {
      isValid = true
    } else if (type === 'http' && (value.startsWith('http://') || value.startsWith('https://'))) {
      isValid = true
    }
  } catch (error) {
    isValid = false
  }
  
  if (!isValid) {
    callback(new Error(`请输入有效的${type.toUpperCase()}配置URL`))
  } else {
    callback()
  }
}

// 监听props变化
watch(() => props.proxyData, (newData) => {
  if (newData && props.mode === 'edit') {
    formData.value = {
      name: newData.name || '',
      type: newData.type || 'vless',
      config: newData.config || '',
      priority: newData.priority || 1,
      remarks: newData.remarks || ''
    }
  }
}, { immediate: true })

watch(() => props.visible, (newVisible) => {
  if (newVisible && props.mode === 'create') {
    // 重置表单
    formData.value = {
      name: '',
      type: 'vless',
      config: '',
      priority: 1,
      remarks: ''
    }
  }
})

const handleClose = () => {
  emit('update:visible', false)
  // 清除验证状态
  if (formRef.value) {
    formRef.value.clearValidate()
  }
}

const handleSubmit = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    submitting.value = true
    
    const submitData = {
      ...formData.value,
      id: props.proxyData?.id || `proxy_${Date.now()}`
    }
    
    emit('submit', submitData)
    
  } catch (error) {
    console.error('表单验证失败:', error)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
