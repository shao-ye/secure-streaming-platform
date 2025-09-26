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
    // 检查用户是否已登录
    if (!userStore.isLoggedIn && !userStore.isChecking) {
      await userStore.checkAuth()
    }

    // 需要认证的路由
    if (to.meta.requiresAuth && !userStore.isLoggedIn) {
      return { path: '/login', replace: true }
    }

    // 需要管理员权限的路由
    if (to.meta.requiresAdmin && userStore.user?.role !== 'admin') {
      return { path: '/', replace: true }
    }

    // 已登录用户访问登录页面，重定向到主页
    if (to.path === '/login' && userStore.isLoggedIn) {
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
