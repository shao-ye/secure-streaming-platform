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

      <!-- 云盘目录选择器：点击目标路径旁的“浏览”打开，选中后回填 manualPath / catalogId -->
      <CloudDriveFolderPicker
        v-model="pickerVisible"
        @confirm="handlePickerConfirm"
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
            <!--
              目标类型：
                - cloudFile: 默认文件目录（个人网盘）
                - familyAlbum: 家庭相册（家庭云下的某个相册）
              上传执行时按此值路由到不同的 139 云盘 API 分支。
            -->
            <el-radio-group v-model="form.recordConfig.upload.destinationType">
              <el-radio label="cloudFile">默认文件目录</el-radio>
              <el-radio label="familyAlbum">家庭相册</el-radio>
            </el-radio-group>
            <div style="margin-top: 5px; font-size: 12px; color: #909399;">
              默认文件目录对应个人网盘；家庭相册需先在“浏览”中选中某个家庭下的相册。
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
                placeholder="点击右侧「浏览」从云盘选择目标目录"
                readonly
              />
              <el-button :icon="FolderOpened" @click="handleOpenFolderPicker">
                浏览…
              </el-button>
              <el-button
                :loading="validateUploadTargetLoading"
                @click="handleValidateUploadTarget"
              >
                路径校验
              </el-button>
            </div>
            <div style="margin-top: 5px; font-size: 12px; color: #909399;">
              点击“浏览”从云盘目录中选择上传位置；选择后会自动回填路径、catalogId 并标记为已校验。
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

          <!-- 🆕 迭代 3：上传队列实时状态（对话框打开且上传开启时每 10s 轮询） -->
          <el-form-item label="上传队列">
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
              <!-- 一行：队列总体状态 + 待传/上传中数量 -->
              <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <el-tag :type="uploadQueueRunningTagType">{{ uploadQueueRunningLabel }}</el-tag>
                <span style="font-size: 12px; color: #606266;">
                  待传 {{ uploadQueueStatus?.queue?.pending ?? 0 }} · 上传中 {{ uploadQueueStatus?.queue?.uploading ?? 0 }}
                </span>
                <span v-if="totalSuccessCount" style="font-size: 12px; color: #67c23a;">
                  累计成功 {{ totalSuccessCount }}
                </span>
                <span v-if="totalFailedCount" style="font-size: 12px; color: #e6a23c;">
                  累计失败 {{ totalFailedCount }}
                </span>
              </div>

              <!-- 当前任务：文件名 + 进度条 + 进度文案 + 已持续时长 + 尝试次数 -->
              <template v-if="currentUploadFileName">
                <div style="font-size: 12px; color: #409eff; word-break: break-all;">
                  📤 当前：{{ currentUploadFileName }}
                </div>
                <el-progress
                  v-if="currentUploadProgressPercent !== null"
                  :percentage="currentUploadProgressPercent"
                  :status="currentUploadProgressStatus"
                  :stroke-width="8"
                  style="margin-top: 2px;"
                />
                <div style="font-size: 12px; color: #909399; display: flex; gap: 12px; flex-wrap: wrap;">
                  <span v-if="currentUploadPhaseLabel">{{ currentUploadPhaseLabel }}</span>
                  <span v-if="currentUploadSizeText">{{ currentUploadSizeText }}</span>
                  <span v-if="currentUploadElapsedText">已持续 {{ currentUploadElapsedText }}</span>
                  <span v-if="currentUploadAttemptText" style="color: #e6a23c;">{{ currentUploadAttemptText }}</span>
                </div>
              </template>

              <!-- 最近失败摘要 -->
              <div v-if="latestUploadFailure" style="font-size: 12px; color: #f56c6c; word-break: break-all;">
                ❌ 最近失败：{{ latestUploadFailure }}
              </div>

              <!-- 行为说明（固定展示，降低管理员疑惑） -->
              <div style="font-size: 12px; color: #909399;">
                成功上传后，文件名末尾会加 <code>_u</code> 标记；登录失效会暂停消费，重新扫码后自动恢复。
              </div>
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
import { ref, computed, watch, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { FolderOpened } from '@element-plus/icons-vue';
import axios from '@/utils/axios';
import CloudDriveFolderPicker from './CloudDriveFolderPicker.vue';

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
 * 云盘目录选择器开关，用于 v-model CloudDriveFolderPicker
 */
const pickerVisible = ref(false);

/**
 * 打开云盘目录选择器
 * picker 内部已经通过 Tab 分别对应 "我的文件"和"我的家庭"，用户可任选。
 * 选完后回调会根据 destinationType 自动同步到表单。
 */
function handleOpenFolderPicker() {
  pickerVisible.value = true;
}

/**
 * 云盘目录选择确认回调
 * 按 payload.destinationType 分派回填表单：
 *   - cloudFile   (个人网盘)：回填 manualPath / catalogId / targetName / resolvedPath
 *   - familyAlbum (家庭相册)：回填 groupId / albumId / targetName，并用 139 原生 URL
 *                   格式 /familycloud/{cloudId}/{albumName} 填入 manualPath 方便用户辨认
 * 选择器回填后视同“已校验”（这是前端语义的 validated，服务端校验仍可点「路径校验」再跑一遍）。
 * @param {Object} payload picker emit 的 结构（包含 destinationType 等字段）
 */
function handlePickerConfirm(payload) {
  const destinationType = payload?.destinationType || 'cloudFile';

  if (destinationType === 'familyAlbum') {
    const { path, cloudId, albumId, albumName, familyName } = payload || {};
    // 139 原生 URL 路径，与用户在浏览器报地址栏看到的一致，便于核对
    const manualPathForDisplay = cloudId && albumName
      ? `/familycloud/${cloudId}/${albumName}`
      : (path || '/');
    form.value.recordConfig.upload = {
      ...form.value.recordConfig.upload,
      destinationType: 'familyAlbum',
      selectorMode: 'manual',
      groupId: cloudId || '',
      albumId: albumId || '',
      targetName: albumName || '',
      catalogId: '',
      manualPath: manualPathForDisplay,
      resolvedPath: `家庭相册 / ${familyName || '未知家庭'} / ${albumName || '未知相册'}`,
      status: 'validated'
    };
    ElMessage.success(`已选择家庭相册：${familyName || ''} / ${albumName || ''}`);
    return;
  }

  // 默认文件目录（cloudFile）- 保持原有逻辑
  const { path, fileId, name } = payload || {};
  form.value.recordConfig.upload = {
    ...form.value.recordConfig.upload,
    destinationType: 'cloudFile',
    selectorMode: 'manual',
    // 切回个人网盘时清理家庭相册专属字段，避免历史数据串值
    groupId: '',
    albumId: '',
    manualPath: path || '/',
    catalogId: fileId || '',
    targetName: name || '',
    resolvedPath: path ? `默认文件目录 / ${String(path).replace(/^\//, '')}` : '默认文件目录',
    status: 'validated'
  };
  ElMessage.success(`已选择目录：${path}`);
}

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
 * 根据 destinationType 提交不同字段给后端：
 *   - cloudFile  : destinationType, selectorMode, manualPath
 *   - familyAlbum: destinationType, selectorMode, groupId, albumId, targetName
 * 后端返回的 resolvedPath / catalogId / targetName 会回填到表单。
 */
async function handleValidateUploadTarget() {
  const uploadCfg = form.value.recordConfig.upload;
  const destinationType = uploadCfg.destinationType || 'cloudFile';

  // 不同目标类型的前置非空检查
  if (destinationType === 'familyAlbum') {
    if (!uploadCfg.groupId || !uploadCfg.albumId) {
      ElMessage.warning('请先通过「浏览」选中家庭相册');
      return;
    }
  } else if (!uploadCfg.manualPath) {
    ElMessage.warning('请输入需要校验的目标路径');
    return;
  }

  validateUploadTargetLoading.value = true;
  try {
    // 按目标类型组装 payload
    const payload = destinationType === 'familyAlbum'
      ? {
          destinationType,
          selectorMode: uploadCfg.selectorMode || 'manual',
          groupId: uploadCfg.groupId,
          albumId: uploadCfg.albumId,
          targetName: uploadCfg.targetName
        }
      : {
          destinationType,
          selectorMode: uploadCfg.selectorMode || 'manual',
          manualPath: uploadCfg.manualPath
        };

    const response = await axios.post(`${CLOUD_DRIVE_API_PREFIX}/validate-target`, payload);

    if (response.data?.status === 'success') {
      form.value.recordConfig.upload = {
        ...form.value.recordConfig.upload,
        targetName: response.data.data?.targetName || uploadCfg.targetName,
        // cloudFile 以后端返回为准；familyAlbum 保留已有 albumId
        catalogId: destinationType === 'familyAlbum'
          ? uploadCfg.catalogId || ''
          : (response.data.data?.catalogId || ''),
        resolvedPath: response.data.data?.resolvedPath || uploadCfg.resolvedPath || uploadCfg.manualPath,
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

// ==================== 迭代 3：上传队列实时状态轮询 ====================

/**
 * 上传队列 + Worker 的实时状态（/api/upload/queue-status 返回）
 * 结构定义见 vps-server/src/routes/upload.js
 */
const uploadQueueStatus = ref(null);
/**
 * 用于让「已持续时长」显示保持响应式；每次 fetchUploadQueueStatus 成功时刷新
 * 精度跟随 10s 轮询即可，无需单独秒级计时
 */
const nowTick = ref(Date.now());
let uploadQueueTimer = null;

/**
 * 当前正在上传的文件名（取队列中第一个 uploading，截断展示）
 */
const currentUploadFileName = computed(() => {
  const list = uploadQueueStatus.value?.queue?.uploadingList || [];
  if (!list.length) return '';
  const fullPath = list[0] || '';
  const name = fullPath.split('/').pop() || '';
  return name.length > 60 ? '…' + name.slice(-60) : name;
});

/**
 * 当前 Worker 执行的任务（含进度 / 尝试次数 / 启动时间）
 */
const currentWorkerTask = computed(() => {
  return uploadQueueStatus.value?.worker?.stats?.currentTask || null;
});

/**
 * 当前进度百分比（0-100），没有则返回 null（模板不渲染进度条）
 */
const currentUploadProgressPercent = computed(() => {
  const p = currentWorkerTask.value?.progress;
  if (!p || typeof p.percent !== 'number') return null;
  // 限制到 [0, 100]，防止因浮点计算产生负数 / 超过 100
  return Math.max(0, Math.min(100, Math.round(p.percent)));
});

/**
 * 进度条的状态色（hash 阶段 / put 阶段 100% 高亮）
 */
const currentUploadProgressStatus = computed(() => {
  const p = currentWorkerTask.value?.progress;
  if (!p) return '';
  if (p.phase === 'put' && p.percent >= 100) return 'success';
  return '';
});

/**
 * 进度阶段文案：hash / put 映射到中文
 */
const currentUploadPhaseLabel = computed(() => {
  const p = currentWorkerTask.value?.progress;
  if (!p) return '';
  if (p.phase === 'hash') return '📝 正在计算 SHA256';
  if (p.phase === 'put') return '📤 流式上传中';
  return '';
});

/**
 * 已上传大小文案（put 阶段才展示 X / Y MB）
 */
const currentUploadSizeText = computed(() => {
  const p = currentWorkerTask.value?.progress;
  if (!p || p.phase !== 'put' || !p.total) return '';
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
  return `${mb(p.uploaded)} / ${mb(p.total)} MB`;
});

/**
 * 当前任务已持续时长文案（按 10s 轮询刷新）
 */
const currentUploadElapsedText = computed(() => {
  const task = currentWorkerTask.value;
  if (!task || !task.startedAt) return '';
  const elapsedMs = Math.max(0, nowTick.value - task.startedAt);
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
});

/**
 * 尝试次数提示（仅在 attempt > 1 时展示，减少正常情况干扰）
 */
const currentUploadAttemptText = computed(() => {
  const task = currentWorkerTask.value;
  if (!task || !task.attempt || task.attempt <= 1) return '';
  return `第 ${task.attempt} 次重试`;
});

/**
 * Worker 累计成功 / 失败数（Worker 重启后会重置，仅本进程内累计）
 */
const totalSuccessCount = computed(() => {
  return uploadQueueStatus.value?.worker?.stats?.totalSuccess || 0;
});
const totalFailedCount = computed(() => {
  return uploadQueueStatus.value?.worker?.stats?.totalFailed || 0;
});

/**
 * 最近一条失败摘要（文件名 + 原因 + 时间）
 */
const latestUploadFailure = computed(() => {
  const arr = uploadQueueStatus.value?.queue?.recentFailures || [];
  if (!arr.length) return '';
  const f = arr[0];
  const name = (f.filePath || '').split('/').pop() || '(未知文件)';
  const short = name.length > 50 ? '…' + name.slice(-50) : name;
  const when = f.finishedAt ? new Date(f.finishedAt).toLocaleTimeString() : '';
  const reason = f.reason || f.error || '未知原因';
  return `${short}（${reason}${when ? ' · ' + when : ''}）`;
});

/**
 * 队列运行标签文案
 */
const uploadQueueRunningLabel = computed(() => {
  const w = uploadQueueStatus.value?.worker;
  if (!w) return '未启动';
  if (w.running && !w.paused) return '运行中';
  if (w.paused) return `已暂停（${w.lastAuthMessage || '登录失效'}）`;
  return '已停止';
});

/**
 * 队列运行标签颜色
 */
const uploadQueueRunningTagType = computed(() => {
  const w = uploadQueueStatus.value?.worker;
  if (!w || !w.running) return 'info';
  if (w.paused) return 'warning';
  return 'success';
});

/**
 * 拉取一次队列状态
 * 静默失败：网络抖动/服务重启时不弹出错误框，避免打扰管理员
 */
async function fetchUploadQueueStatus() {
  try {
    const resp = await axios.get('/api/upload/queue-status');
    if (resp.data?.status === 'success') {
      uploadQueueStatus.value = resp.data.data;
      // 刷新时间戳让「已持续时长」按 10s 节拍重新计算
      nowTick.value = Date.now();
    }
  } catch (err) {
    // 静默忽略
  }
}

/**
 * 启动轮询（幂等：重复调不会叠加定时器）
 */
function startPollingUploadQueue() {
  if (uploadQueueTimer) return;
  fetchUploadQueueStatus();
  uploadQueueTimer = setInterval(fetchUploadQueueStatus, 10000);
}

/**
 * 停止轮询并清理展示缓存
 */
function stopPollingUploadQueue() {
  if (uploadQueueTimer) {
    clearInterval(uploadQueueTimer);
    uploadQueueTimer = null;
  }
  uploadQueueStatus.value = null;
}

// 对话框打开 + 上传开关启用时才轮询；关闭或关闭上传时立即停止
watch(
  () => [props.modelValue, form.value && form.value.recordConfig && form.value.recordConfig.upload && form.value.recordConfig.upload.enabled],
  ([visibleNow, uploadOn]) => {
    if (visibleNow && uploadOn) {
      startPollingUploadQueue();
    } else {
      stopPollingUploadQueue();
    }
  }
);

// 组件卸载时兵底清理定时器，避免异步泄漏
onUnmounted(() => {
  stopPollingUploadQueue();
});
</script>

<style scoped>
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
