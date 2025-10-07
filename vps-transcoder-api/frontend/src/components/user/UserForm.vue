<template>
  <el-dialog 
    :title="mode === 'create' ? '创建用户' : '编辑用户'"
    v-model="dialogVisible"
    width="600px"
    :close-on-click-modal="false"
  >
    <el-form 
      :model="formData" 
      :rules="rules" 
      ref="formRef" 
      label-width="100px"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="用户名" prop="username">
        <el-input 
          v-model="formData.username" 
          :disabled="mode === 'edit'"
          placeholder="请输入用户名"
          maxlength="20"
          show-word-limit
        />
        <div class="form-tip" v-if="mode === 'edit'">
          用户名创建后不可修改
        </div>
      </el-form-item>
      
      <el-form-item label="显示名称" prop="displayName">
        <el-input 
          v-model="formData.displayName" 
          placeholder="请输入显示名称"
          maxlength="50"
          show-word-limit
        />
      </el-form-item>
      
      <el-form-item label="邮箱" prop="email">
        <el-input 
          v-model="formData.email" 
          placeholder="请输入邮箱地址"
          type="email"
        />
      </el-form-item>
      
      <el-form-item label="角色" prop="role">
        <el-select v-model="formData.role" placeholder="请选择角色" disabled>
          <el-option label="普通用户" value="user" />
        </el-select>
        <div class="form-tip">
          注：创建的用户默认为普通用户，只有admin账号具有管理权限
        </div>
      </el-form-item>
      
      <el-form-item v-if="mode === 'create'" label="密码" prop="password">
        <el-input 
          v-model="formData.password" 
          type="password" 
          placeholder="请输入密码"
          show-password
          maxlength="50"
        />
      </el-form-item>
      
      <el-form-item v-if="mode === 'create'" label="确认密码" prop="confirmPassword">
        <el-input 
          v-model="formData.confirmPassword" 
          type="password" 
          placeholder="请再次输入密码"
          show-password
          maxlength="50"
        />
      </el-form-item>
    </el-form>
    
    <template #footer>
      <el-button @click="handleCancel">取消</el-button>
      <el-button 
        type="primary" 
        @click="handleSubmit" 
        :loading="loading"
      >
        {{ mode === 'create' ? '创建' : '保存' }}
      </el-button>
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
    default: 'create'
  },
  userData: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'submit'])

const formRef = ref()
const loading = ref(false)

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value)
})

const formData = ref({
  username: '',
  displayName: '',
  email: '',
  role: 'user',
  password: '',
  confirmPassword: ''
})

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为3-20个字符', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '用户名只能包含字母、数字和下划线', trigger: 'blur' }
  ],
  displayName: [
    { required: true, message: '请输入显示名称', trigger: 'blur' },
    { min: 1, max: 50, message: '显示名称长度为1-50个字符', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, max: 50, message: '密码长度为6-50个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== formData.value.password) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

watch(() => props.userData, (newData) => {
  if (newData && props.mode === 'edit') {
    formData.value = {
      username: newData.username || '',
      displayName: newData.displayName || '',
      email: newData.email || '',
      role: 'user',
      password: '',
      confirmPassword: ''
    }
  }
}, { immediate: true })

watch(() => props.visible, (visible) => {
  if (visible && props.mode === 'create') {
    resetForm()
  }
})

const resetForm = () => {
  formData.value = {
    username: '',
    displayName: '',
    email: '',
    role: 'user',
    password: '',
    confirmPassword: ''
  }
  
  if (formRef.value) {
    formRef.value.clearValidate()
  }
}

const handleCancel = () => {
  dialogVisible.value = false
  resetForm()
}

const handleSubmit = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
    
    loading.value = true
    
    const submitData = {
      username: formData.value.username,
      displayName: formData.value.displayName,
      email: formData.value.email,
      role: 'user'
    }
    
    if (props.mode === 'create') {
      submitData.password = formData.value.password
    }
    
    emit('submit', submitData)
    
  } catch (error) {
    console.error('表单验证失败:', error)
    ElMessage.error('请检查表单输入')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

:deep(.el-form-item__label) {
  font-weight: 500;
}

:deep(.el-input__count) {
  font-size: 12px;
}
</style>
