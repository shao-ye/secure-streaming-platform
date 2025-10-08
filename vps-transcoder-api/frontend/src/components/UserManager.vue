<template>
  <div class="user-manager">
    <!-- 用户管理头部 -->
    <div class="user-header">
      <div class="header-left">
        <h3>用户管理</h3>
        <el-tag type="info" size="small">
          共 {{ userManagementStore.users.length }} 个用户
        </el-tag>
      </div>
      <div class="header-right">
        <el-button 
          type="primary" 
          @click="handleCreateUser"
          :icon="Plus"
        >
          创建用户
        </el-button>
        <el-button 
          @click="refreshUsers"
          :icon="Refresh"
          :loading="userManagementStore.loading"
        >
          刷新
        </el-button>
      </div>
    </div>

    <!-- 用户统计卡片 -->
    <div class="stats-cards">
      <el-card class="stat-card">
        <div class="stat-item">
          <div class="stat-value">{{ userManagementStore.adminUsers.length }}</div>
          <div class="stat-label">管理员</div>
        </div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-item">
          <div class="stat-value">{{ userManagementStore.normalUsers.length }}</div>
          <div class="stat-label">普通用户</div>
        </div>
      </el-card>
      <el-card class="stat-card">
        <div class="stat-item">
          <div class="stat-value">{{ userManagementStore.activeUsers.length }}</div>
          <div class="stat-label">活跃用户</div>
        </div>
      </el-card>
    </div>

    <!-- 用户列表 -->
    <el-card class="user-list-card">
      <UserList
        :users="userManagementStore.users"
        :loading="userManagementStore.loading"
        @edit="handleEditUser"
        @delete="handleDeleteUser"
        @change-password="handleChangePassword"
        @toggle-status="handleToggleStatus"
      />
    </el-card>

    <!-- 创建/编辑用户对话框 -->
    <UserForm
      v-model:visible="showCreateDialog"
      :mode="formMode"
      :user-data="currentUser"
      @submit="handleUserSubmit"
    />
    
    <!-- 修改密码对话框 -->
    <PasswordChangeDialog
      v-model:visible="showPasswordDialog"
      :user="currentUser"
      @submit="handlePasswordChange"
    />

    <!-- 操作日志对话框 - 暂时移除 -->
    <!-- <OperationLogsDialog
      v-model:visible="showLogsDialog"
    /> -->
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import { useUserManagementStore } from '../stores/userManagement'
import UserList from './user/UserList.vue'
import UserForm from './user/UserForm.vue'
import PasswordChangeDialog from './user/PasswordChangeDialog.vue'
// import OperationLogsDialog from './user/OperationLogsDialog.vue'

const userManagementStore = useUserManagementStore()

// 对话框状态
const showCreateDialog = ref(false)
const showPasswordDialog = ref(false)
const showLogsDialog = ref(false)

// 表单状态
const formMode = ref('create') // 'create' | 'edit'
const currentUser = ref(null)

// 刷新用户列表
const refreshUsers = async () => {
  try {
    await userManagementStore.fetchUsers()
    ElMessage.success('用户列表已刷新')
  } catch (error) {
    ElMessage.error('刷新用户列表失败: ' + error.message)
  }
}

// 处理创建用户
const handleCreateUser = () => {
  currentUser.value = null
  formMode.value = 'create'
  showCreateDialog.value = true
}

// 处理编辑用户
const handleEditUser = (user) => {
  currentUser.value = { ...user }
  formMode.value = 'edit'
  showCreateDialog.value = true
}

// 处理删除用户
const handleDeleteUser = async (user) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户 "${user.displayName}" 吗？此操作不可恢复。`,
      '删除用户',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )

    await userManagementStore.deleteUser(user.id)
    ElMessage.success('用户删除成功')
    // 🔥 自动刷新用户列表
    await refreshUsers()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除用户失败: ' + error.message)
    }
  }
}

// 处理修改密码
const handleChangePassword = (user) => {
  currentUser.value = user
  showPasswordDialog.value = true
}

// 处理切换用户状态
const handleToggleStatus = async (user) => {
  try {
    const action = user.status === 'active' ? '禁用' : '启用'
    const newStatus = user.status === 'active' ? 'inactive' : 'active'
    
    await ElMessageBox.confirm(
      `确定要${action}用户 "${user.displayName}" 吗？`,
      `${action}用户`,
      {
        confirmButtonText: `确定${action}`,
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await userManagementStore.toggleUserStatus(user.id, newStatus)
    ElMessage.success(`用户已${action}`)
    // 🔥 自动刷新用户列表
    await refreshUsers()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败: ' + error.message)
    }
  }
}

// 处理用户表单提交
const handleUserSubmit = async (userData) => {
  try {
    if (formMode.value === 'create') {
      await userManagementStore.createUser(userData)
      ElMessage.success('用户创建成功')
    } else {
      await userManagementStore.updateUser(currentUser.value.id, userData)
      ElMessage.success('用户信息更新成功')
    }
    
    showCreateDialog.value = false
    currentUser.value = null
    // 🔥 自动刷新用户列表
    await refreshUsers()
  } catch (error) {
    ElMessage.error('操作失败: ' + error.message)
  }
}

// 处理密码修改提交
const handlePasswordChange = async (passwordData) => {
  try {
    await userManagementStore.changePassword(currentUser.value.id, passwordData.newPassword)
    ElMessage.success('密码修改成功')
    showPasswordDialog.value = false
    currentUser.value = null
    // 🔥 自动刷新用户列表
    await refreshUsers()
  } catch (error) {
    ElMessage.error('密码修改失败: ' + error.message)
  }
}

// 组件挂载时获取用户列表
onMounted(() => {
  refreshUsers()
})
</script>

<style scoped>
.user-manager {
  padding: 20px;
}

.user-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h3 {
  margin: 0;
  color: #303133;
}

.header-right {
  display: flex;
  gap: 10px;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  text-align: center;
}

.stat-item {
  padding: 10px;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #409eff;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}

.user-list-card {
  margin-top: 20px;
}
</style>
