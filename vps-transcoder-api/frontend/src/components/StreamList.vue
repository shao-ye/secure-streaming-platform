<template>
  <div class="stream-list">
    <div v-if="streamsStore.loading" class="loading-container">
      <el-skeleton :rows="5" animated />
    </div>

    <div v-else-if="streamsStore.streams.length === 0" class="empty-container">
      <el-empty 
        description="暂无可用频道"
        :image-size="150"
      />
    </div>

    <div v-else class="streams-container">
      <div 
        v-for="stream in streamsStore.streams" 
        :key="stream.id"
        class="stream-item"
        :class="{ active: selectedStreamId === stream.id }"
        @click="selectStream(stream)"
      >
        <div class="stream-icon">
          <el-icon size="24">
            <VideoCamera />
          </el-icon>
        </div>
        <div class="stream-info">
          <h4 class="stream-name">{{ stream.name }}</h4>
        </div>
        <div class="stream-action">
          <el-icon 
            v-if="selectedStreamId === stream.id" 
            class="playing-icon"
            color="#67c23a"
          >
            <CaretRight />
          </el-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { VideoCamera, CaretRight } from '@element-plus/icons-vue'
import { useStreamsStore } from '../stores/streams'

const emit = defineEmits(['stream-select'])

const streamsStore = useStreamsStore()
const selectedStreamId = ref('')

const selectStream = (stream) => {
  selectedStreamId.value = stream.id
  emit('stream-select', stream)
}
</script>

<style scoped>
.stream-list {
  flex: 1;
  overflow-y: auto;
  max-height: calc(100vh - 140px); /* 限制最大高度，为头部和标题留出空间 */
  min-height: 400px; /* 设置最小高度 */
}

.loading-container {
  padding: 20px;
}

.empty-container {
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.streams-container {
  padding: 0;
  /* 确保容器可以滚动 */
  overflow-y: auto;
}

.stream-item {
  display: flex;
  align-items: center;
  padding: 15px 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  border-bottom: 1px solid #f0f0f0;
  background-color: #fff;
}

.stream-item:hover {
  background-color: #f5f7fa;
}

.stream-item.active {
  background-color: #ecf5ff;
  border-left: 4px solid #409eff;
}

.stream-icon {
  margin-right: 12px;
  color: #606266;
}

.stream-info {
  flex: 1;
  min-width: 0;
}

.stream-name {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-id {
  margin: 0;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-action {
  margin-left: 8px;
}

.playing-icon {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.6; }
  100% { opacity: 1; }
}

/* 隐藏滚动条但保持滚动功能 */
.stream-list {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.stream-list::-webkit-scrollbar {
  display: none;
}

.streams-container {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.streams-container::-webkit-scrollbar {
  display: none;
}
</style>
