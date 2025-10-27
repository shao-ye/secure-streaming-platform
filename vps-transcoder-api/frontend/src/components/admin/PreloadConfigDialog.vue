<template>
  <el-dialog
    v-model="visible"
    title="预加载配置"
    width="500px"
    :before-close="handleClose"
  >
    <el-form :model="form" label-width="100px" :rules="rules" ref="formRef">
      <el-form-item label="频道">
        <el-input v-model="channelName" disabled />
      </el-form-item>
      
      <el-form-item label="预加载开关" prop="enabled">
        <el-switch
          v-model="form.enabled"
          active-text="启用"
          inactive-text="禁用"
        />
      </el-form-item>
      
      <el-form-item label="开始时间" prop="startTime">
        <el-time-picker
          v-model="form.startTime"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="选择开始时间"
          :disabled="!form.enabled"
        />
      </el-form-item>
      
      <el-form-item label="结束时间" prop="endTime">
        <el-time-picker
          v-model="form.endTime"
          format="HH:mm"
          value-format="HH:mm"
          placeholder="选择结束时间"
          :disabled="!form.enabled"
        />
      </el-form-item>
      
      <el-alert
        v-if="form.enabled"
        :title="preloadInfo"
        type="info"
        :closable="false"
        style="margin-bottom: 15px"
      />
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
import api from '@/api';

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

const emit = defineEmits(['update:modelValue', 'saved']);

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const formRef = ref(null);
const saving = ref(false);

const form = ref({
  enabled: false,
  startTime: '07:00',
  endTime: '17:30'
});

const rules = {
  startTime: [
    { required: true, message: '请选择开始时间', trigger: 'change' }
  ],
  endTime: [
    { required: true, message: '请选择结束时间', trigger: 'change' }
  ]
};

// 计算预加载信息
const preloadInfo = computed(() => {
  if (!form.value.enabled) return '';
  
  const start = form.value.startTime;
  const end = form.value.endTime;
  
  // 判断是否跨天
  const isCrossDay = end < start;
  
  if (isCrossDay) {
    return `预加载时段：每天 ${start} - 次日 ${end} (跨天)`;
  } else {
    return `预加载时段：每天 ${start} - ${end}`;
  }
});

// 监听对话框打开，加载配置
watch(() => props.modelValue, async (val) => {
  if (val) {
    await loadConfig();
  }
});

// 加载预加载配置
async function loadConfig() {
  try {
    const response = await api.get(`/api/preload/config/${props.channelId}`);
    
    if (response.data.status === 'success') {
      const config = response.data.data;
      form.value = {
        enabled: config.enabled || false,
        startTime: config.startTime || '07:00',
        endTime: config.endTime || '17:30'
      };
    }
  } catch (error) {
    console.error('加载预加载配置失败:', error);
    ElMessage.error('加载配置失败');
  }
}

// 保存配置
async function handleSave() {
  try {
    await formRef.value.validate();
    
    saving.value = true;
    
    const response = await api.put(`/api/preload/config/${props.channelId}`, {
      enabled: form.value.enabled,
      startTime: form.value.startTime,
      endTime: form.value.endTime
    });
    
    if (response.data.status === 'success') {
      ElMessage.success('预加载配置已保存');
      emit('saved');
      handleClose();
    } else {
      throw new Error(response.data.message || '保存失败');
    }
  } catch (error) {
    console.error('保存预加载配置失败:', error);
    if (error.message) {
      ElMessage.error(error.message);
    } else {
      ElMessage.error('保存配置失败');
    }
  } finally {
    saving.value = false;
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
