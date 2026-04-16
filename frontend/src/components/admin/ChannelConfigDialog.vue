<template>
  <el-dialog
    v-model="visible"
    title="频道配置"
    width="600px"
    :before-close="handleClose"
  >
    <el-form :model="form" label-width="100px" :rules="rules" ref="formRef">
      <el-form-item label="频道">
        <el-input :value="channelName" disabled />
      </el-form-item>
      
      <!-- ========== 上半部分：预加载配置 ========== -->
      <el-divider content-position="left">
        <span style="font-weight: bold;">预加载配置</span>
      </el-divider>
      
      <el-form-item label="预加载开关" prop="preloadConfig.enabled">
        <el-switch
          v-model="form.preloadConfig.enabled"
          active-text="启用"
          inactive-text="禁用"
        />
      </el-form-item>
      
      <el-form-item label="开始时间" prop="preloadConfig.startTime">
        <el-time-picker
          v-model="form.preloadConfig.startTime"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="选择开始时间"
          :disabled="!form.preloadConfig.enabled"
          :clearable="false"
          :editable="false"
        />
      </el-form-item>
      
      <el-form-item label="结束时间" prop="preloadConfig.endTime">
        <el-time-picker
          v-model="form.preloadConfig.endTime"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="选择结束时间"
          :disabled="!form.preloadConfig.enabled"
          :clearable="false"
          :editable="false"
        />
      </el-form-item>
      
      <el-form-item label="仅工作日" prop="preloadConfig.workdaysOnly">
        <el-switch
          v-model="form.preloadConfig.workdaysOnly"
          active-text="启用"
          inactive-text="禁用"
          :disabled="!form.preloadConfig.enabled"
        />
        <div style="margin-top: 5px; font-size: 12px; color: #909399;">
          启用后仅在工作日进行预加载（自动识别法定节假日和调休）
        </div>
      </el-form-item>
      
      <el-alert
        v-if="form.preloadConfig.enabled"
        :title="preloadInfo"
        type="info"
        :closable="false"
        style="margin-bottom: 15px"
      />
      
      <!-- ========== 视频格式配置 ========== -->
      <el-divider content-position="left">
        <span style="font-weight: bold;">视频格式</span>
      </el-divider>
      
      <el-form-item label="视频比例">
        <el-radio-group v-model="form.videoAspectRatio">
          <el-radio label="original">原始比例</el-radio>
          <el-radio label="4:3">4:3 标准</el-radio>
          <el-radio label="16:9">16:9 宽屏</el-radio>
        </el-radio-group>
        <div style="margin-top: 8px; font-size: 12px; color: #909399;">
          原始比例：保持源视频比例 | 4:3/16:9：拉伸到指定比例（观看和录制均生效）
        </div>
      </el-form-item>
      
      <!-- ========== 下半部分：录制配置 ========== -->
      <el-divider content-position="left">
        <span style="font-weight: bold;">录制配置</span>
      </el-divider>
      
      <el-form-item label="录制开关" prop="recordConfig.enabled">
        <el-switch
          v-model="form.recordConfig.enabled"
          active-text="启用"
          inactive-text="禁用"
        />
      </el-form-item>
      
      <el-form-item label="开始时间" prop="recordConfig.startTime">
        <el-time-picker
          v-model="form.recordConfig.startTime"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="选择开始时间"
          :disabled="!form.recordConfig.enabled"
          :clearable="false"
          :editable="false"
        />
      </el-form-item>
      
      <el-form-item label="结束时间" prop="recordConfig.endTime">
        <el-time-picker
          v-model="form.recordConfig.endTime"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="选择结束时间"
          :disabled="!form.recordConfig.enabled"
          :clearable="false"
          :editable="false"
        />
      </el-form-item>
      
      <el-form-item label="仅工作日" prop="recordConfig.workdaysOnly">
        <el-switch
          v-model="form.recordConfig.workdaysOnly"
          active-text="启用"
          inactive-text="禁用"
          :disabled="!form.recordConfig.enabled"
        />
        <div style="margin-top: 5px; font-size: 12px; color: #909399;">
          启用后仅在工作日进行录制（自动识别法定节假日和调休）
        </div>
      </el-form-item>
      
      <el-form-item label="存储路径" prop="recordConfig.storagePath">
        <el-input
          v-model="form.recordConfig.storagePath"
          placeholder="/var/www/recordings"
          :disabled="!form.recordConfig.enabled"
        />
        <div style="margin-top: 5px; font-size: 12px; color: #909399;">
          录制文件保存路径（如需通过FileBrowser访问，请使用 /srv/filebrowser/yoyo-k）
        </div>
      </el-form-item>
      
      <el-alert
        v-if="form.recordConfig.enabled"
        :title="recordInfo"
        type="success"
        :closable="false"
        style="margin-bottom: 15px"
      />

      <template v-if="form.recordConfig.enabled">
        <el-divider content-position="left">
          <span style="font-weight: bold;">自动上传配置</span>
        </el-divider>

        <el-form-item label="自动上传">
          <el-switch
            v-model="form.recordConfig.upload.enabled"
            active-text="启用"
            inactive-text="禁用"
          />
        </el-form-item>

        <template v-if="form.recordConfig.upload.enabled">
          <el-form-item label="目标类型">
            <el-radio-group v-model="form.recordConfig.upload.destinationType">
              <el-radio label="cloudFile">默认文件目录</el-radio>
            </el-radio-group>
            <div style="margin-top: 5px; font-size: 12px; color: #909399;">
              V1 先支持默认文件目录手动路径配置与校验。
            </div>
          </el-form-item>

          <el-form-item label="选择方式">
            <el-radio-group v-model="form.recordConfig.upload.selectorMode">
              <el-radio label="manual">手动路径</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="目标路径">
            <div style="display: flex; width: 100%; gap: 10px;">
              <el-input
                v-model="form.recordConfig.upload.manualPath"
                placeholder="例如：/我的视频/幼儿园录制"
              />
              <el-button
                :loading="validateUploadTargetLoading"
                @click="handleValidateUploadTarget"
              >
                路径校验
              </el-button>
            </div>
            <div style="margin-top: 5px; font-size: 12px; color: #909399;">
              当前先校验路径格式并回填目标展示，后续再补真实远端目录可写性验证。
            </div>
          </el-form-item>

          <el-form-item label="当前目标">
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
              <el-tag type="info">{{ form.recordConfig.upload.resolvedPath || '尚未校验目标路径' }}</el-tag>
              <span style="font-size: 12px; color: #909399;">
                状态：{{ uploadStatusLabel }}
              </span>
            </div>
          </el-form-item>
        </template>
      </template>
    </el-form>
    
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">
          保存
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import axios from '@/utils/axios';

const CLOUD_DRIVE_API_PREFIX = '/api/cloud-drive';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  channelId: {
    type: String,
    required: true
  },
  channelName: {
    type: String,
    required: true
  }
});

/**
 * 自动上传状态文案
 * 用于在频道配置弹窗中展示当前目标校验结果或待处理状态。
 */
const uploadStatusLabel = computed(() => {
  const uploadStatus = form.value.recordConfig.upload?.status;
  const labelMap = {
    idle: '待校验',
    validated: '已校验',
    invalid: '校验失败'
  };

  return labelMap[uploadStatus] || '待校验';
});

const emit = defineEmits(['update:modelValue', 'saved', 'configUpdated']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const formRef = ref(null);
const saving = ref(false);
const validateUploadTargetLoading = ref(false);

/**
 * 获取默认自动上传配置
 * 统一补齐页面字段，避免后端未返回时导致表单响应式缺失。
 * @returns {Object} 默认上传配置
 */
function createDefaultUploadConfig() {
  return {
    enabled: false,
    destinationType: 'cloudFile',
    selectorMode: 'manual',
    targetName: '',
    groupId: '',
    albumId: '',
    catalogId: '',
    manualPath: '',
    resolvedPath: '',
    uploadTrigger: 'after_finalize',
    retryTimes: 3,
    status: 'idle'
  };
}

const form = ref({
  preloadConfig: {
    enabled: false,
    startTime: '07:00',
    endTime: '17:30',
    workdaysOnly: false
  },
  recordConfig: {
    enabled: false,
    startTime: '07:40',
    endTime: '17:25',
    workdaysOnly: false,
    storagePath: '/var/www/recordings',
    upload: createDefaultUploadConfig()
  },
  videoAspectRatio: 'original'  // 🆕 视频比例配置
});

const rules = {
  'preloadConfig.startTime': [
    { required: true, message: '请选择预加载开始时间', trigger: 'change' }
  ],
  'preloadConfig.endTime': [
    { required: true, message: '请选择预加载结束时间', trigger: 'change' }
  ],
  'recordConfig.startTime': [
    { required: true, message: '请选择录制开始时间', trigger: 'change' }
  ],
  'recordConfig.endTime': [
    { required: true, message: '请选择录制结束时间', trigger: 'change' }
  ],
  'recordConfig.storagePath': [
    { required: true, message: '请输入存储路径', trigger: 'blur' }
  ]
};

// 计算预加载信息
const preloadInfo = computed(() => {
  if (!form.value.preloadConfig.enabled) return '';
  
  const start = form.value.preloadConfig.startTime;
  const end = form.value.preloadConfig.endTime;
  const timePrefix = form.value.preloadConfig.workdaysOnly ? '工作日' : '每天';
  const isCrossDay = end < start;
  
  if (isCrossDay) {
    return `预加载时段：${timePrefix} ${start} - 次日 ${end} (跨天)`;
  } else {
    return `预加载时段：${timePrefix} ${start} - ${end}`;
  }
});

// 计算录制信息
const recordInfo = computed(() => {
  if (!form.value.recordConfig.enabled) return '';
  
  const start = form.value.recordConfig.startTime;
  const end = form.value.recordConfig.endTime;
  const timePrefix = form.value.recordConfig.workdaysOnly ? '工作日' : '每天';
  const isCrossDay = end < start;
  
  if (isCrossDay) {
    return `录制时段：${timePrefix} ${start} - 次日 ${end} (跨天)`;
  } else {
    return `录制时段：${timePrefix} ${start} - ${end}`;
  }
});

// 监听对话框打开，加载配置
watch(() => props.modelValue, async (val) => {
  if (val) {
    await loadConfig();
  }
});

// 加载配置
async function loadConfig() {
  try {
    console.log('🔄 开始加载频道配置', { channelId: props.channelId });
    
    // 并行加载预加载和录制配置（添加时间戳防止缓存）
    const timestamp = Date.now();
    const [preloadResponse, recordResponse] = await Promise.all([
      axios.get(`/api/preload/config/${props.channelId}?t=${timestamp}`),
      axios.get(`/api/record/config/${props.channelId}?t=${timestamp}`)
    ]);
    
    // 加载预加载配置
    if (preloadResponse.data.status === 'success') {
      const config = preloadResponse.data.data;
      console.log('✅ 预加载配置加载成功', config);
      form.value.preloadConfig = {
        enabled: config.enabled === true,  // 🔧 修复：严格判断，避免 || 导致的问题
        startTime: config.startTime || '07:00',
        endTime: config.endTime || '17:30',
        workdaysOnly: config.workdaysOnly === true
      };
    }
    
    // 加载录制配置
    if (recordResponse.data.status === 'success') {
      const config = recordResponse.data.data;
      console.log('✅ 录制配置加载成功', config);
      console.log('📝 录制开关状态:', {
        原始值: config.enabled,
        类型: typeof config.enabled,
        设置为: config.enabled === true
      });
      
      form.value.recordConfig = {
        enabled: config.enabled === true,  // 🔧 修复：严格判断 true，false 保持为 false
        startTime: config.startTime || '07:40',
        endTime: config.endTime || '17:25',
        workdaysOnly: config.workdaysOnly === true,
        storagePath: config.storagePath || '/var/www/recordings',
        upload: {
          ...createDefaultUploadConfig(),
          ...(config.upload || {})
        }
      };
      
      console.log('✅ form.recordConfig.enabled 最终值:', form.value.recordConfig.enabled);
    }
    
    // 🆕 加载视频比例配置
    try {
      const timestamp = Date.now();
      const configResponse = await axios.get(`/api/channel/${props.channelId}/config?t=${timestamp}`);
      if (configResponse.data.status === 'success') {
        form.value.videoAspectRatio = configResponse.data.data.videoAspectRatio || 'original';
        console.log('✅ 视频比例配置加载成功:', form.value.videoAspectRatio);
      }
    } catch (error) {
      console.warn('⚠️ 加载视频比例配置失败，使用默认值:', error.message);
      form.value.videoAspectRatio = 'original';
    }
  } catch (error) {
    console.error('❌ 加载配置失败:', error);
    ElMessage.error('加载配置失败');
  }
}

// 保存配置
async function handleSave() {
  try {
    await formRef.value.validate();
    
    saving.value = true;
    
    console.log('💾 开始保存配置', {
      channelId: props.channelId,
      channelName: props.channelName,
      recordEnabled: form.value.recordConfig.enabled,
      preloadEnabled: form.value.preloadConfig.enabled
    });
    
    // 🔥 一次性提交完整配置，避免分开提交导致的竞争条件
    const configData = {
      preloadConfig: {
        enabled: form.value.preloadConfig.enabled,
        startTime: form.value.preloadConfig.startTime,
        endTime: form.value.preloadConfig.endTime,
        workdaysOnly: form.value.preloadConfig.workdaysOnly
      },
      recordConfig: {
        enabled: form.value.recordConfig.enabled,
        startTime: form.value.recordConfig.startTime,
        endTime: form.value.recordConfig.endTime,
        workdaysOnly: form.value.recordConfig.workdaysOnly,
        storagePath: form.value.recordConfig.storagePath,
        upload: {
          ...createDefaultUploadConfig(),
          ...form.value.recordConfig.upload,
          uploadTrigger: 'after_finalize'
        }
      },
      videoAspectRatio: form.value.videoAspectRatio  // 🆕 提交视频比例配置
    };
    
    console.log('📤 提交配置:', configData);
    
    // 一次性保存完整配置
    const response = await axios.put(`/api/channel/${props.channelId}/config`, configData);
    
    console.log('📥 保存结果:', {
      status: response.data.status,
      message: response.data.message
    });
    
    // 检查结果
    const allSuccess = response.data.status === 'success';
    
    if (allSuccess) {
      console.log('✅ 所有配置保存成功');
      
      // 🔧 Workers已在保存配置时自动异步调用VPS reload，前端无需再次触发
      // 这样避免了前端→Workers→VPS→Workers的循环依赖导致的死锁问题
      
      // 注意：由于Cloudflare KV是最终一致性存储，配置可能需要几秒钟才能全球生效
      // 但API返回成功就表示数据已保存，VPS调度器会自动重载
      ElMessage.success('频道配置已保存');
      
      // 🔥 新增：传递更新后的配置数据，避免KV最终一致性问题
      emit('configUpdated', {
        channelId: props.channelId,
        preloadConfig: configData.preloadConfig,
        recordConfig: configData.recordConfig
      });
      
      emit('saved');
      handleClose();
    } else {
      throw new Error('部分配置保存失败');
    }
  } catch (error) {
    console.error('保存配置失败:', error);
    console.error('错误详情:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      config: error.config
    });
    
    // 🔧 更详细的错误提示
    let errorMsg = '保存配置失败';
    if (error.response?.data?.message) {
      errorMsg = error.response.data.message;
    } else if (error.message) {
      errorMsg = error.message;
    }
    
    // 🔧 如果是奇怪的错误消息，显示更多信息
    if (errorMsg.includes('频控') || errorMsg.includes('访问')) {
      console.error('🔴 检测到非常规错误:', errorMsg);
      ElMessage.error(`${errorMsg} (请检查浏览器控制台查看详细信息)`);
    } else {
      ElMessage.error(errorMsg);
    }
  } finally {
    saving.value = false;
  }
}

/**
 * 校验自动上传目标路径
 * 当前版本先调用后端完成默认文件目录的基础路径格式校验，并回填展示字段。
 */
async function handleValidateUploadTarget() {
  if (!form.value.recordConfig.upload.manualPath) {
    ElMessage.warning('请输入需要校验的目标路径');
    return;
  }

  validateUploadTargetLoading.value = true;
  try {
    const response = await axios.post(`${CLOUD_DRIVE_API_PREFIX}/validate-target`, {
      destinationType: form.value.recordConfig.upload.destinationType,
      selectorMode: form.value.recordConfig.upload.selectorMode,
      manualPath: form.value.recordConfig.upload.manualPath
    });

    if (response.data?.status === 'success') {
      form.value.recordConfig.upload = {
        ...form.value.recordConfig.upload,
        targetName: response.data.data?.targetName || form.value.recordConfig.upload.targetName,
        catalogId: response.data.data?.catalogId || '',
        resolvedPath: response.data.data?.resolvedPath || form.value.recordConfig.upload.manualPath,
        status: 'validated'
      };

      ElMessage.success(response.data.message || '路径校验成功');
      return;
    }

    form.value.recordConfig.upload.status = 'invalid';
    ElMessage.error(response.data?.message || '路径校验失败');
  } catch (error) {
    form.value.recordConfig.upload.status = 'invalid';
    ElMessage.error(error.response?.data?.message || '路径校验失败');
  } finally {
    validateUploadTargetLoading.value = false;
  }
}

// 关闭对话框
function handleClose() {
  visible.value = false;
}
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
