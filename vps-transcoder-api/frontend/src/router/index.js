import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user'
import Login from '../views/Login.vue'
import Dashboard from '../views/Dashboard.vue'
import AdminPanel from '../views/AdminPanel.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: Login,
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard,
    meta: { requiresAuth: true }
  },
  {
    path: '/admin',
    name: 'AdminPanel',
    component: AdminPanel,
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/dashboard',
    redirect: '/'
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach(async (to) => {
  const userStore = useUserStore()

  // 跳过404重定向的检查
  if (to.name === 'NotFound') {
    return true
  }

  try {
    // 如果访问登录页面，不需要认证检查
    if (to.path === '/login') {
      // 如果已经登录，重定向到主页
      if (userStore.isLoggedIn) {
        return { path: '/', replace: true }
      }
      return true
    }

    // 对于需要认证的路由，首先检查store是否已初始化
    if (to.meta.requiresAuth) {
      // 如果store还未初始化，等待初始化完成
      if (!userStore.isInitialized) {
        // 等待一个tick让初始化完成
        await new Promise(resolve => setTimeout(resolve, 10))
        // 如果仍未初始化，跳转到登录页
        if (!userStore.isInitialized) {
          return { path: '/login', replace: true }
        }
      }
      
      // 如果没有token，直接跳转到登录页，不调用checkAuth避免循环
      if (!userStore.token) {
        return { path: '/login', replace: true }
      }
      
      // 如果有token但用户信息为空，且不在检查中，才进行认证检查
      if (!userStore.user && !userStore.isChecking) {
        try {
          await userStore.checkAuth()
        } catch (error) {
          console.error('认证检查失败:', error)
          // 认证失败，跳转到登录页
          return { path: '/login', replace: true }
        }
      }
      
      // 再次检查是否登录成功
      if (!userStore.isLoggedIn) {
        return { path: '/login', replace: true }
      }
    }

    // 需要管理员权限的路由
    if (to.meta.requiresAdmin && userStore.user?.role !== 'admin') {
      return { path: '/', replace: true }
    }

    return true
  } catch (error) {
    console.error('路由守卫错误:', error)
    // 如果认证检查失败，重定向到登录页
    if (to.path !== '/login') {
      return { path: '/login', replace: true }
    }
    return true
  }
})

export default router
