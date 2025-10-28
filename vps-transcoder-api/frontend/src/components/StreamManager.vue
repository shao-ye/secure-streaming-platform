<template>
  <div class="stream-manager">

    <!-- 频道列表 -->
    <el-card class="list-card" shadow="never">
      <template #header>
        <div class="list-header">
          <h3>频道列表</h3>
          <div class="header-actions">
            <el-button 
              type="primary"
              @click="showAddDialog = true"
            >
              添加频道
            </el-button>
            <el-button 
              :icon="Refresh"
              @click="refreshList"
              :loading="streamsStore.loading"
            >
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <div class="table-container">
        <el-table
          v-loading="streamsStore.loading"
          :data="sortedStreams"
          stripe
          border
          style="width: 100%"
          :height="tableHeight"
        >
        <el-table-column type="index" label="序号" width="60" :index="(index) => index + 1" />
        <el-table-column prop="name" label="频道名称" min-width="200" />
        <el-table-column prop="rtmpUrl" label="RTMP地址" min-width="300">
          <template #default="scope">
            <el-tooltip :content="scope.row.rtmpUrl" placement="top">
              <span class="rtmp-url">{{ scope.row.rtmpUrl }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="预加载状态" width="110" align="center">
          <template #default="scope">
            <el-tooltip 
              v-if="scope.row.preloadConfig?.enabled"
              :content="getPreloadConfigDescription(scope.row)"
              placement="top"
              effect="dark"
            >
              <el-tag 
                :type="getPreloadStatusType(scope.row)"
                size="small"
                effect="plain"
                style="cursor: help"
              >
                {{ getPreloadStatusText(scope.row) }}
              </el-tag>
            </el-tooltip>
            <el-tag 
              v-else
              :type="getPreloadStatusType(scope.row)"
              size="small"
              effect="plain"
            >
              {{ getPreloadStatusText(scope.row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="录制状态" width="110" align="center">
          <template #default="scope">
            <el-tooltip 
              v-if="scope.row.recordConfig?.enabled"
              :content="getRecordConfigDescription(scope.row)"
              placement="top"
              effect="dark"
            >
              <el-tag 
                :type="getRecordStatusType(scope.row)"
                size="small"
                effect="plain"
                style="cursor: help"
              >
                {{ getRecordStatusText(scope.row) }}
              </el-tag>
            </el-tooltip>
            <el-tag 
              v-else
              :type="getRecordStatusType(scope.row)"
              size="small"
              effect="plain"
            >
              {{ getRecordStatusText(scope.row) }}
            </el-tag>
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
        <el-table-column label="操作" width="280" fixed="right">
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
              type="success"
              size="small"
              :icon="Timer"
              @click="openPreloadConfig(scope.row)"
            >
              配置
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

    <!-- 添加频道弹出框 -->
    <el-dialog
      v-model="showAddDialog"
      title="添加新频道"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="addFormRef"
        :model="addForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item label="频道名称" prop="name">
          <el-input
            v-model="addForm.name"
            placeholder="请输入频道名称，如：大厅监控"
            clearable
          />
        </el-form-item>
        <el-form-item label="RTMP地址" prop="rtmpUrl">
          <el-input
            v-model="addForm.rtmpUrl"
            placeholder="rtmp://example.com/live/stream"
            clearable
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="handleAddDialogClose">取消</el-button>
        <el-button 
          type="primary" 
          :loading="addLoading"
          @click="handleAdd"
        >
          添加频道
        </el-button>
      </template>
    </el-dialog>

    <!-- 🆕 频道配置对话框（预加载 + 录制） -->
    <ChannelConfigDialog
      v-model="preloadDialogVisible"
      :channel-id="currentChannel.id"
      :channel-name="currentChannel.name"
      @saved="handlePreloadSaved"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Edit, Delete, ArrowUp, ArrowDown, Timer } from '@element-plus/icons-vue'
import { useStreamsStore } from '../stores/streams'
import ChannelConfigDialog from './admin/ChannelConfigDialog.vue'
import dayjs from 'dayjs'

const streamsStore = useStreamsStore()

const addFormRef = ref(null)
const editFormRef = ref(null)
const addLoading = ref(false)
const editLoading = ref(false)
const editDialogVisible = ref(false)
const showAddDialog = ref(false)

// 🆕 预加载配置对话框
const preloadDialogVisible = ref(false)
const currentChannel = ref({ id: '', name: '' })

// 排序后的频道列表
const sortedStreams = computed(() => {
  const streams = [...streamsStore.streams]
  return streams.sort((a, b) => {
    const orderA = a.sortOrder || 0
    const orderB = b.sortOrder || 0
    return orderA - orderB
  })
})

// 动态计算表格高度，适应不同浏览器大小
const tableHeight = computed(() => {
  // 计算可用高度：视窗高度减去页面其他元素占用的空间
  // 包括：页面标题、卡片边距、表格标题等
  const availableHeight = window.innerHeight - 200
  // 确保最小高度能显示至少4行数据，最大高度不超过视窗
  return Math.max(350, Math.min(700, availableHeight))
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
      showAddDialog.value = false
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
    console.log('🔧 开始更新频道:', editForm)
    
    const result = await streamsStore.updateStream(editForm.id, {
      name: editForm.name,
      rtmpUrl: editForm.rtmpUrl,
      sortOrder: editForm.sortOrder
    })

    console.log('🔧 更新结果:', result)

    if (result.success) {
      ElMessage.success('频道更新成功')
      editDialogVisible.value = false
      // 刷新频道列表
      await streamsStore.fetchAdminStreams()
    } else {
      ElMessage.error(result.message || '更新失败')
      console.error('🔧 更新失败:', result)
    }
  } catch (error) {
    console.error('🔧 更新异常:', error)
    ElMessage.error(`更新失败: ${error.message || '请稍后重试'}`)
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

// 获取预加载状态文字
const getPreloadStatusText = (stream) => {
  if (!stream.preloadConfig) {
    return '未配置'
  }
  return stream.preloadConfig.enabled ? '已启用' : '已禁用'
}

// 获取预加载状态标签类型
const getPreloadStatusType = (stream) => {
  if (!stream.preloadConfig) {
    return 'info'
  }
  return stream.preloadConfig.enabled ? 'success' : 'info'
}

// 获取录制状态文字
const getRecordStatusText = (stream) => {
  if (!stream.recordConfig) {
    return '未配置'
  }
  return stream.recordConfig.enabled ? '已启用' : '已禁用'
}

// 获取录制状态标签类型
const getRecordStatusType = (stream) => {
  if (!stream.recordConfig) {
    return 'info'
  }
  return stream.recordConfig.enabled ? 'success' : 'info'
}

// 获取录制配置描述文本（用于tooltip）
const getRecordConfigDescription = (stream) => {
  if (!stream.recordConfig || !stream.recordConfig.enabled) {
    return ''
  }
  
  const config = stream.recordConfig
  const start = config.startTime || '07:40'
  const end = config.endTime || '17:25'
  
  // 根据工作日设置选择时段描述
  const timePrefix = config.workdaysOnly ? '工作日' : '每天'
  
  // 判断是否跨天
  const startHour = parseInt(start.split(':')[0])
  const endHour = parseInt(end.split(':')[0])
  const isCrossDay = endHour < startHour || (endHour === startHour && end < start)
  
  if (isCrossDay) {
    return `录制时段：${timePrefix} ${start} - 次日 ${end}`
  } else {
    return `录制时段：${timePrefix} ${start} - ${end}`
  }
}

// 获取预加载配置描述文本（用于tooltip）
const getPreloadConfigDescription = (stream) => {
  if (!stream.preloadConfig || !stream.preloadConfig.enabled) {
    return ''
  }
  
  const config = stream.preloadConfig
  const start = config.startTime || '07:00'
  const end = config.endTime || '17:30'
  
  // 根据工作日设置选择时段描述
  const timePrefix = config.workdaysOnly ? '工作日' : '每天'
  
  // 判断是否跨天
  const isCrossDay = end < start
  
  if (isCrossDay) {
    return `预加载时段: ${timePrefix} ${start} - 次日 ${end} (跨天)`
  } else {
    return `预加载时段: ${timePrefix} ${start} - ${end}`
  }
}

// 处理添加对话框关闭
const handleAddDialogClose = () => {
  showAddDialog.value = false
  resetAddForm()
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

// 🆕 打开预加载配置对话框
const openPreloadConfig = (stream) => {
  currentChannel.value = {
    id: stream.id,
    name: stream.name
  }
  preloadDialogVisible.value = true
}

// 🆕 频道配置保存成功回调（预加载 + 录制）
const handlePreloadSaved = async () => {
  // 刷新频道列表以更新预加载和录制状态显示
  await streamsStore.fetchAdminStreams()
  // 提示消息已经在ChannelConfigDialog中显示，这里不重复显示
}

onMounted(() => {
  streamsStore.fetchAdminStreams()
})
</script>

<style scoped>
.stream-manager {
  space-y: 20px;
}

.list-card {
  margin-bottom: 20px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.list-header h3 {
  margin: 0;
}

.table-container {
  border-radius: 4px;
  position: relative;
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
  
  .header-actions {
    flex-wrap: wrap;
    width: 100%;
  }
  
  .header-actions .el-button {
    flex: 1;
    min-width: 80px;
  }
  
  /* 移动端表格优化 */
  .table-container {
    overflow-x: auto;
  }
  
  .table-container :deep(.el-table) {
    min-width: 800px;
  }
  
  /* 移动端对话框优化 */
  .el-dialog {
    width: 95% !important;
    margin: 0 auto;
  }
}
</style>
