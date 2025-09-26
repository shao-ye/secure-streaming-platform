<template>
  <div class="stream-manager">
    <!-- 添加频道表单 -->
    <el-card class="add-form-card" shadow="never">
      <template #header>
        <h3>添加新频道</h3>
      </template>

      <el-form
        ref="addFormRef"
        :model="addForm"
        :rules="formRules"
        label-width="100px"
        @submit.prevent="handleAdd"
      >
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="频道名称" prop="name">
              <el-input
                v-model="addForm.name"
                placeholder="请输入频道名称，如：大厅监控"
                clearable
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="RTMP地址" prop="rtmpUrl">
              <el-input
                v-model="addForm.rtmpUrl"
                placeholder="rtmp://example.com/live/stream"
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item>
          <el-button 
            type="primary" 
            :loading="addLoading"
            @click="handleAdd"
          >
            添加频道
          </el-button>
          <el-button @click="resetAddForm">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 频道列表 -->
    <el-card class="list-card" shadow="never">
      <template #header>
        <div class="list-header">
          <h3>频道列表</h3>
          <el-button 
            :icon="Refresh"
            @click="refreshList"
            :loading="streamsStore.loading"
          >
            刷新
          </el-button>
        </div>
      </template>

      <el-table
        v-loading="streamsStore.loading"
        :data="streamsStore.streams"
        stripe
        border
        style="width: 100%"
      >
        <el-table-column prop="id" label="ID" width="120" />
        <el-table-column prop="name" label="频道名称" min-width="200" />
        <el-table-column prop="rtmpUrl" label="RTMP地址" min-width="300">
          <template #default="scope">
            <el-tooltip :content="scope.row.rtmpUrl" placement="top">
              <span class="rtmp-url">{{ scope.row.rtmpUrl }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="scope">
            {{ formatDate(scope.row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="scope">
            <el-button
              type="primary"
              size="small"
              :icon="Edit"
              @click="startEdit(scope.row)"
            >
              编辑
            </el-button>
            <el-button
              type="danger"
              size="small"
              :icon="Delete"
              @click="handleDelete(scope.row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!streamsStore.loading && streamsStore.streams.length === 0" class="empty-state">
        <el-empty description="暂无频道数据" />
      </div>
    </el-card>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      title="编辑频道"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="editFormRef"
        :model="editForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item label="频道ID">
          <el-input v-model="editForm.id" disabled />
        </el-form-item>
        <el-form-item label="频道名称" prop="name">
          <el-input
            v-model="editForm.name"
            placeholder="请输入频道名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="RTMP地址" prop="rtmpUrl">
          <el-input
            v-model="editForm.rtmpUrl"
            placeholder="rtmp://example.com/live/stream"
            clearable
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button 
          type="primary" 
          :loading="editLoading"
          @click="handleEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Edit, Delete } from '@element-plus/icons-vue'
import { useStreamsStore } from '../stores/streams'
import dayjs from 'dayjs'

const streamsStore = useStreamsStore()

const addFormRef = ref(null)
const editFormRef = ref(null)
const addLoading = ref(false)
const editLoading = ref(false)
const editDialogVisible = ref(false)

const addForm = reactive({
  name: '',
  rtmpUrl: ''
})

const editForm = reactive({
  id: '',
  name: '',
  rtmpUrl: ''
})

const formRules = {
  name: [
    { required: true, message: '请输入频道名称', trigger: 'blur' },
    { min: 2, max: 50, message: '频道名称长度在 2 到 50 个字符', trigger: 'blur' }
  ],
  rtmpUrl: [
    { required: true, message: '请输入RTMP地址', trigger: 'blur' },
    { 
      pattern: /^rtmp:\/\/.+/, 
      message: 'RTMP地址格式不正确，应以rtmp://开头', 
      trigger: 'blur' 
    }
  ]
}

const handleAdd = async () => {
  if (!addFormRef.value) return

  const valid = await addFormRef.value.validate().catch(() => false)
  if (!valid) return

  addLoading.value = true

  try {
    const result = await streamsStore.addStream({
      name: addForm.name,
      rtmpUrl: addForm.rtmpUrl
    })

    if (result.success) {
      ElMessage.success('频道添加成功')
      resetAddForm()
    } else {
      ElMessage.error(result.message || '添加失败')
    }
  } catch (error) {
    ElMessage.error('添加失败，请稍后重试')
  } finally {
    addLoading.value = false
  }
}

const resetAddForm = () => {
  addForm.name = ''
  addForm.rtmpUrl = ''
  if (addFormRef.value) {
    addFormRef.value.clearValidate()
  }
}

const startEdit = (stream) => {
  editForm.id = stream.id
  editForm.name = stream.name
  editForm.rtmpUrl = stream.rtmpUrl
  editDialogVisible.value = true
}

const handleEdit = async () => {
  if (!editFormRef.value) return

  const valid = await editFormRef.value.validate().catch(() => false)
  if (!valid) return

  editLoading.value = true

  try {
    const result = await streamsStore.updateStream(editForm.id, {
      name: editForm.name,
      rtmpUrl: editForm.rtmpUrl
    })

    if (result.success) {
      ElMessage.success('频道更新成功')
      editDialogVisible.value = false
    } else {
      ElMessage.error(result.message || '更新失败')
    }
  } catch (error) {
    ElMessage.error('更新失败，请稍后重试')
  } finally {
    editLoading.value = false
  }
}

const handleDelete = async (stream) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除频道 "${stream.name}" 吗？此操作不可恢复。`,
      '确认删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )

    const result = await streamsStore.deleteStream(stream.id)

    if (result.success) {
      ElMessage.success('频道删除成功')
    } else {
      ElMessage.error(result.message || '删除失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败，请稍后重试')
    }
  }
}

const refreshList = () => {
  streamsStore.fetchAdminStreams()
}

const formatDate = (timestamp) => {
  if (!timestamp) return '-'
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

onMounted(() => {
  streamsStore.fetchAdminStreams()
})
</script>

<style scoped>
.stream-manager {
  space-y: 20px;
}

.add-form-card, .list-card {
  margin-bottom: 20px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h3 {
  margin: 0;
}

.rtmp-url {
  display: inline-block;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 12px;
}

.empty-state {
  padding: 40px 0;
  text-align: center;
}

@media (max-width: 768px) {
  .list-header {
    flex-direction: column;
    gap: 15px;
    align-items: flex-start;
  }
}
</style>
