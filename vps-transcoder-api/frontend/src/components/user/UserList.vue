<template>
  <div class="user-list">
    <el-table 
      :data="users" 
      stripe 
      :loading="loading"
      empty-text="暂无用户数据"
    >
      <el-table-column prop="username" label="用户名" width="120" />
      
      <el-table-column prop="displayName" label="显示名称" width="150" />
      
      <!-- 邮箱列暂时隐藏，用不上 -->
      <!-- <el-table-column prop="email" label="邮箱" width="200" /> -->
      
      <el-table-column prop="role" label="角色" width="100">
        <template #default="{ row }">
          <el-tag :type="getRoleType(row.role)">
            {{ getRoleText(row.role) }}
          </el-tag>
        </template>
      </el-table-column>
      
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'">
            {{ row.status === 'active' ? '活跃' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      
      <el-table-column prop="lastLogin" label="最后登录" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.lastLogin) }}
        </template>
      </el-table-column>
      
      <el-table-column prop="loginCount" label="登录次数" width="100" />
      
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>
      </el-table-column>
      
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <div class="action-buttons">
            <el-button 
              size="small" 
              @click="$emit('edit', row)"
              :icon="Edit"
            >
              编辑
            </el-button>
            
            <el-button 
              size="small" 
              type="warning"
              @click="$emit('change-password', row)"
              :icon="Key"
            >
              改密
            </el-button>
            
            <el-button 
              size="small" 
              :type="row.status === 'active' ? 'warning' : 'success'"
              @click="$emit('toggle-status', row)"
              :icon="row.status === 'active' ? Lock : Unlock"
            >
              {{ row.status === 'active' ? '禁用' : '启用' }}
            </el-button>
            
            <el-button 
              size="small" 
              type="danger" 
              @click="$emit('delete', row)"
              :disabled="row.username === 'admin'"
              :icon="Delete"
            >
              删除
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { Edit, Delete, Key, Lock, Unlock } from '@element-plus/icons-vue'

defineProps({
  users: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  }
})

defineEmits(['edit', 'delete', 'change-password', 'toggle-status'])

// 角色显示文本映射 (简化二级权限系统)
const getRoleText = (role) => {
  const roleMap = {
    'admin': '管理员',
    'user': '普通用户'
  }
  return roleMap[role] || '未知角色'
}

// 角色标签类型映射
const getRoleType = (role) => {
  const typeMap = {
    'admin': 'danger',    // 红色 - 管理员权限
    'user': 'info'        // 蓝色 - 普通用户
  }
  return typeMap[role] || 'info'
}

// 格式化日期时间
const formatDateTime = (dateString) => {
  if (!dateString) return '从未'
  
  try {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (error) {
    return '无效日期'
  }
}
</script>

<style scoped>
.user-list {
  width: 100%;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-start;
}

:deep(.el-table) {
  font-size: 14px;
}

:deep(.el-table .cell) {
  padding: 8px 12px;
}

:deep(.el-table__body-wrapper) {
  max-height: calc(100vh - 400px);
  overflow-y: auto;
}

.action-buttons .el-button {
  margin: 0;
  padding: 4px 8px;
  font-size: 12px;
  min-width: auto;
}

.action-buttons .el-button + .el-button {
  margin-left: 0;
}

/* 优化表格尺寸 */
:deep(.el-table th) {
  padding: 8px 0;
}

:deep(.el-table td) {
  padding: 6px 0;
}
</style>
