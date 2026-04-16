<template>
  <el-dialog
    v-model="dialogVisible"
    title="系统设置"
    width="680px"
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

      <el-divider content-position="left">录制分段配置</el-divider>
      
      <el-form-item label="启用录制分段">
        <el-switch v-model="form.segmentEnabled" />
        <div style="margin-top: 5px; color: #909399; font-size: 12px;">
          启用后按设置时长自动分段，避免单文件过大
        </div>
      </el-form-item>
      
      <el-form-item label="分段时长" v-if="form.segmentEnabled">
        <el-input-number 
          v-model="form.segmentDuration" 
          :min="3" 
          :max="240"
          style="width: 150px"
        />
        <span style="margin-left: 10px;">分钟</span>
        <div style="margin-top: 5px; color: #909399; font-size: 12px;">
          录制时长达到设置值时自动切换到新文件（范围：3-240分钟）
        </div>
        <div style="margin-top: 10px;">
          <el-button size="small" @click="form.segmentDuration = 30">30分钟</el-button>
          <el-button size="small" @click="form.segmentDuration = 60">1小时</el-button>
          <el-button size="small" @click="form.segmentDuration = 120">2小时</el-button>
        </div>
      </el-form-item>

      <el-divider content-position="left">文件恢复配置</el-divider>
      
      <el-form-item label="恢复扫描时长">
        <el-input-number 
          v-model="form.recoveryScanHours" 
          :min="12" 
          :max="168"
          style="width: 150px"
        />
        <span style="margin-left: 10px;">小时</span>
        <div style="margin-top: 5px; color: #909399; font-size: 12px;">
          启动时扫描并修复最近 {{ form.recoveryScanHours }} 小时内的录制文件（范围：12-168小时）
        </div>
        <div style="margin-top: 10px;">
          <el-button size="small" @click="form.recoveryScanHours = 24">24小时</el-button>
          <el-button size="small" @click="form.recoveryScanHours = 48">48小时</el-button>
          <el-button size="small" @click="form.recoveryScanHours = 72">72小时</el-button>
        </div>
      </el-form-item>

      <el-divider content-position="left">中国移动云盘配置</el-divider>

      <el-form-item label="启用云盘能力">
        <el-switch v-model="form.cloudDrive.enabled" />
      </el-form-item>

      <template v-if="form.cloudDrive.enabled">
        <el-form-item label="登录方式">
          <el-tag type="success">手机验证码登录</el-tag>
          <div style="margin-top: 5px; color: #909399; font-size: 12px;">
            V1 仅实现手机验证码登录，二维码登录与目录树选择器暂不启用。
          </div>
        </el-form-item>

        <el-form-item label="手机号">
          <el-input
            v-model="form.cloudDrive.account"
            maxlength="11"
            placeholder="请输入 11 位手机号"
          />
        </el-form-item>

        <el-form-item label="验证码">
          <div style="display: flex; width: 100%; gap: 10px;">
            <el-input
              v-model="form.cloudDrive.smsCode"
              maxlength="8"
              placeholder="请输入短信验证码"
            />
            <el-button
              :loading="sendSmsLoading"
              @click="handleSendSms"
            >
              获取验证码
            </el-button>
          </div>
        </el-form-item>

        <el-form-item label="当前状态">
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <el-tag :type="cloudDriveStatusTagType">{{ cloudDriveStatusLabel }}</el-tag>
              <span style="color: #606266; font-size: 13px;">
                {{ form.cloudDrive.authMessage || '尚未完成云盘登录验证' }}
              </span>
            </div>
            <div style="font-size: 12px; color: #909399; line-height: 1.8;">
              <div>已绑定账号：{{ form.cloudDrive.accountMasked || form.cloudDrive.account || '未设置' }}</div>
              <div>最近验证时间：{{ form.cloudDrive.lastValidatedAt || '暂无' }}</div>
              <div>预计过期时间：{{ form.cloudDrive.estimatedExpireAt || '暂无' }}</div>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="登录操作">
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <el-button
              type="primary"
              :loading="validateLoginLoading"
              @click="handleValidateCloudDriveLogin"
            >
              登录验证
            </el-button>
            <el-button @click="handleOpenOfficialLoginPage">
              打开官方登录页
            </el-button>
            <el-button @click="fetchCloudDriveStatus">
              刷新登录状态
            </el-button>
          </div>
        </el-form-item>
      </template>

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
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { axios } from '@/utils/axios'

const CLOUD_DRIVE_API_PREFIX = '/api/cloud-drive'

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
const sendSmsLoading = ref(false)
const validateLoginLoading = ref(false)
const formRef = ref(null)

/**
 * 获取默认云盘表单结构
 * 统一用于首次初始化和接口回填，避免字段缺失导致页面报错。
 * @returns {Object} 默认云盘表单
 */
const createDefaultCloudDriveForm = () => ({
  enabled: false,
  provider: 'cmcc139',
  loginMode: 'sms',
  account: '',
  accountMasked: '',
  smsCode: '',
  savePassword: false,
  authStatus: 'unknown',
  authMessage: '',
  lastValidatedAt: '',
  estimatedExpireAt: '',
  lastValidator: ''
})

const form = reactive({
  enabled: true,
  retentionDays: 2,
  segmentEnabled: false,  // 🆕 录制分段开关
  segmentDuration: 60,     // 🆕 分段时长（分钟）
  recoveryScanHours: 48,   // 🆕 恢复扫描时长（小时）
  cloudDrive: createDefaultCloudDriveForm()
})

/**
 * 云盘状态标签类型
 * 根据当前认证状态返回适合的 Element Plus 标签样式。
 */
const cloudDriveStatusTagType = computed(() => {
  const statusTypeMap = {
    valid: 'success',
    expired: 'warning',
    invalid: 'danger',
    risk_control: 'danger',
    unknown: 'info'
  }

  return statusTypeMap[form.cloudDrive.authStatus] || 'info'
})

/**
 * 云盘状态文案
 * 用于在页面上直观展示当前登录态。
 */
const cloudDriveStatusLabel = computed(() => {
  const statusLabelMap = {
    valid: '已验证',
    expired: '已过期',
    invalid: '无效',
    risk_control: '触发风控',
    unknown: '未验证'
  }

  return statusLabelMap[form.cloudDrive.authStatus] || '未验证'
})

/**
 * 同步云盘状态到页面表单
 * 接口已对敏感字段做脱敏，这里只合并允许展示的字段。
 * @param {Object} cloudDriveData 云盘返回数据
 * @param {Object} options 合并选项
 */
const applyCloudDriveData = (cloudDriveData = {}, options = {}) => {
  const {
    preserveEnabled = false,
    preserveSmsCode = false
  } = options

  const mergedCloudDriveData = {
    ...createDefaultCloudDriveForm(),
    ...cloudDriveData
  }

  /**
   * 这里保留页面上尚未点击“保存”的局部编辑状态。
   * 云盘状态刷新接口主要返回登录态元信息，不应该把管理员刚刚手动打开的开关或已输入验证码覆盖掉。
   */
  if (preserveEnabled) {
    mergedCloudDriveData.enabled = form.cloudDrive.enabled
  }

  if (preserveSmsCode) {
    mergedCloudDriveData.smsCode = form.cloudDrive.smsCode
  }

  Object.assign(form.cloudDrive, mergedCloudDriveData)
}

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

/**
 * 获取系统配置
 * 打开弹窗时读取完整设置，并在本地补齐云盘默认字段。
 */
const fetchConfig = async () => {
  loading.value = true
  try {
    const response = await axios.get('/api/admin/cleanup/config')
    if (response.data && response.data.status === 'success') {
      const configData = response.data.data || {}
      form.enabled = configData.enabled === true
      form.retentionDays = configData.retentionDays || 2
      form.segmentEnabled = configData.segmentEnabled === true
      form.segmentDuration = configData.segmentDuration || 60
      form.recoveryScanHours = configData.recoveryScanHours || 48
      applyCloudDriveData(configData.cloudDrive)

      await fetchCloudDriveStatus()
    }
  } catch (error) {
    console.error('获取清理配置失败:', error)
    ElMessage.error('获取清理配置失败')
  } finally {
    loading.value = false
  }
}

/**
 * 刷新云盘登录状态
 * 该接口只返回脱敏后的状态元信息，用于避免页面展示过期状态。
 */
const fetchCloudDriveStatus = async () => {
  try {
    const response = await axios.get(`${CLOUD_DRIVE_API_PREFIX}/auth-status`)
    if (response.data?.status === 'success') {
      applyCloudDriveData(response.data.data, {
        preserveEnabled: true,
        preserveSmsCode: true
      })
    }
  } catch (error) {
    console.error('获取云盘状态失败:', error)
  }
}

/**
 * 保存系统设置
 * 本次保存同时写入原有清理配置和新增的云盘总开关/账号信息。
 */
const handleSave = async () => {
  saveLoading.value = true
  try {
    const response = await axios.put('/api/admin/cleanup/config', {
      enabled: form.enabled,
      retentionDays: form.retentionDays,
      segmentEnabled: form.segmentEnabled,    // 🆕
      segmentDuration: form.segmentDuration,   // 🆕
      recoveryScanHours: form.recoveryScanHours,  // 🆕
      cloudDrive: {
        enabled: form.cloudDrive.enabled,
        account: form.cloudDrive.account,
        savePassword: form.cloudDrive.savePassword
      }
    })
    
    if (response.data && response.data.status === 'success') {
      applyCloudDriveData(response.data.data?.cloudDrive)
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

/**
 * 发送短信验证码
 * 仅校验基础手机号格式，实际发送逻辑由后端统一处理。
 */
const handleSendSms = async () => {
  if (!/^\d{11}$/.test(form.cloudDrive.account || '')) {
    ElMessage.warning('请输入有效的 11 位手机号')
    return
  }

  sendSmsLoading.value = true
  try {
    const response = await axios.post(`${CLOUD_DRIVE_API_PREFIX}/send-sms`, {
      account: form.cloudDrive.account
    })

    if (response.data?.status === 'success') {
      applyCloudDriveData(response.data.data?.cloudDrive, {
        preserveEnabled: true,
        preserveSmsCode: true
      })
      ElMessage.success(response.data.message || '验证码已发送')
    } else {
      ElMessage.error(response.data?.message || '发送验证码失败')
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '发送验证码失败')
  } finally {
    await fetchCloudDriveStatus()
    sendSmsLoading.value = false
  }
}

/**
 * 执行云盘登录验证
 * 当前版本按短信验证码模式提交，成功后刷新页面上的脱敏状态。
 */
const handleValidateCloudDriveLogin = async () => {
  if (!/^\d{11}$/.test(form.cloudDrive.account || '')) {
    ElMessage.warning('请输入有效的 11 位手机号')
    return
  }

  if (!form.cloudDrive.smsCode) {
    ElMessage.warning('请输入短信验证码')
    return
  }

  validateLoginLoading.value = true
  try {
    const response = await axios.post(`${CLOUD_DRIVE_API_PREFIX}/login/validate`, {
      loginMode: 'sms',
      account: form.cloudDrive.account,
      smsCode: form.cloudDrive.smsCode
    })

    if (response.data?.status === 'success') {
      applyCloudDriveData(response.data.data?.cloudDrive, {
        preserveEnabled: true
      })
      form.cloudDrive.smsCode = ''
      ElMessage.success(response.data.message || '云盘登录验证成功')
    } else {
      ElMessage.error(response.data?.message || '云盘登录验证失败')
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '云盘登录验证失败')
  } finally {
    await fetchCloudDriveStatus()
    validateLoginLoading.value = false
  }
}

/**
 * 打开官方登录页
 * 方便管理员在异常场景下直接前往官方页面核对账号状态。
 */
const handleOpenOfficialLoginPage = () => {
  window.open('https://yun.139.com/w/#/', '_blank', 'noopener,noreferrer')
}

/**
 * 手动触发视频清理
 * 保留原有清理能力，供管理员在设置页直接执行。
 */
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

/**
 * 关闭弹窗
 * 仅负责关闭，不额外清空已加载的表单状态。
 */
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
