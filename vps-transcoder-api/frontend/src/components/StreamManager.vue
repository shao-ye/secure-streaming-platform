<template>
  <div class="stream-manager">
    <!-- 添加频道表单 -->
    <el-card class="add-form-card" shadow="never">
      <template #header>
        <div class="form-header">
          <h3>添加新频道</h3>
          <el-button 
            :icon="isFormCollapsed ? ArrowDown : ArrowUp"
            @click="toggleFormCollapse"
            circle
            size="small"
            :title="isFormCollapsed ? '展开表单' : '收起表单'"
          />
        </div>
      </template>

      <el-collapse-transition>
        <div v-show="!isFormCollapsed">
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
        </div>
      </el-collapse-transition>
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
          <el-button 
            type="info"
            @click="debugData"
            size="small"
          >
            调试数据
          </el-button>
        </div>
      </template>

      <div class="table-container">
        <el-table
          v-loading="streamsStore.loading"
          :data="sortedStreams"
          stripe
          border
          style="width: 100%"
          :max-height="tableMaxHeight"
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
        <el-table-column label="排序" width="100" align="center">
          <template #default="scope">
            <span class="sort-order">{{ scope.row.sortOrder || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="scope">
            {{ formatDate(scope.row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="排序操作" width="120" align="center">
          <template #default="scope">
            <el-button-group>
              <el-button
                type="primary"
                size="small"
                :icon="ArrowUp"
                :disabled="scope.$index === 0"
                @click="moveUp(scope.$index)"
                title="上移"
              />
              <el-button
                type="primary"
                size="small"
                :icon="ArrowDown"
                :disabled="scope.$index === sortedStreams.length - 1"
                @click="moveDown(scope.$index)"
                title="下移"
              />
            </el-button-group>
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
      </div>

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
        <el-form-item label="排序序号" prop="sortOrder">
          <el-input-number
            v-model="editForm.sortOrder"
            :min="0"
            :max="999"
            placeholder="排序序号，数字越小越靠前"
            style="width: 100%"
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
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Edit, Delete, ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { useStreamsStore } from '../stores/streams'
import dayjs from 'dayjs'

const streamsStore = useStreamsStore()

const addFormRef = ref(null)
const editFormRef = ref(null)
const addLoading = ref(false)
const editLoading = ref(false)
const editDialogVisible = ref(false)
const isFormCollapsed = ref(false)

// 排序后的频道列表
const sortedStreams = computed(() => {
  const streams = [...streamsStore.streams]
  return streams.sort((a, b) => {
    const orderA = a.sortOrder || 0
    const orderB = b.sortOrder || 0
    return orderA - orderB
  })
})

// 动态计算表格最大高度
const tableMaxHeight = computed(() => {
  // 基础高度：视窗高度减去其他元素占用的空间
  const baseHeight = window.innerHeight - 350 // 增加预留空间，让表格高度更合理
  // 如果表单折叠，可以增加更多高度给表格
  const extraHeight = isFormCollapsed.value ? 100 : 0
  return Math.max(400, baseHeight + extraHeight) // 降低最小高度到400px，确保会出现滚动条
})

const addForm = reactive({
  name: '',
  rtmpUrl: ''
})

const editForm = reactive({
  id: '',
  name: '',
  rtmpUrl: '',
  sortOrder: 0
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
  editForm.sortOrder = stream.sortOrder || 0
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
      rtmpUrl: editForm.rtmpUrl,
      sortOrder: editForm.sortOrder
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

// 调试数据功能
const debugData = () => {
  console.log('=== 调试数据 ===')
  console.log('原始数据:', streamsStore.streams)
  console.log('排序后数据:', sortedStreams.value)
  console.log('表格最大高度:', tableMaxHeight.value)
  console.log('表单是否折叠:', isFormCollapsed.value)
  
  ElMessage.info({
    message: `共${streamsStore.streams.length}条数据，请查看浏览器控制台获取详细信息`,
    duration: 3000
  })
}

const formatDate = (timestamp) => {
  if (!timestamp) return '-'
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss')
}

// 折叠功能
const toggleFormCollapse = () => {
  isFormCollapsed.value = !isFormCollapsed.value
}

// 排序功能
const moveUp = async (index) => {
  if (index === 0) return
  
  const currentStream = sortedStreams.value[index]
  
  // 简单的排序值-1操作
  const newSortOrder = Math.max(1, (currentStream.sortOrder || 1) - 1)
  
  try {
    await streamsStore.updateStreamSort(currentStream.id, newSortOrder)
    ElMessage.success('排序更新成功')
    await streamsStore.fetchAdminStreams() // 刷新列表
  } catch (error) {
    ElMessage.error('排序更新失败')
    console.error('排序更新错误:', error)
  }
}

const moveDown = async (index) => {
  if (index === sortedStreams.value.length - 1) return
  
  const currentStream = sortedStreams.value[index]
  
  // 简单的排序值+1操作
  const newSortOrder = (currentStream.sortOrder || 1) + 1
  
  try {
    await streamsStore.updateStreamSort(currentStream.id, newSortOrder)
    ElMessage.success('排序更新成功')
    await streamsStore.fetchAdminStreams() // 刷新列表
  } catch (error) {
    ElMessage.error('排序更新失败')
    console.error('排序更新错误:', error)
  }
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

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.form-header h3 {
  margin: 0;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list-header h3 {
  margin: 0;
}

.table-container {
  border-radius: 4px;
  position: relative;
  min-height: 400px; /* 设置最小高度确保表格有足够显示空间 */
}

/* 表格滚动条样式优化 */
.table-container :deep(.el-table) {
  border-radius: 4px;
}

.table-container :deep(.el-table__body-wrapper) {
  overflow-y: auto !important;
  scrollbar-width: thin; /* Firefox 滚动条样式 */
}

.table-container :deep(.el-table__body-wrapper::-webkit-scrollbar) {
  width: 10px;
}

.table-container :deep(.el-table__body-wrapper::-webkit-scrollbar-track) {
  background-color: #f1f1f1;
  border-radius: 5px;
}

.table-container :deep(.el-table__body-wrapper::-webkit-scrollbar-thumb) {
  background-color: #c0c4cc;
  border-radius: 5px;
  transition: background-color 0.3s ease;
}

.table-container :deep(.el-table__body-wrapper::-webkit-scrollbar-thumb:hover) {
  background-color: #909399;
}

/* 确保表格头部固定 */
.table-container :deep(.el-table__header-wrapper) {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: #fafafa;
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
