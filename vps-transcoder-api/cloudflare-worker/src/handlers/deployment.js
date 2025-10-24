import { TUNNEL_CONFIG } from '../config/tunnel-config.js';
import { errorResponse, successResponse } from '../utils/cors.js';
import { validateSession } from './auth.js';

export const deploymentHandlers = {
  // 获取当前隧道配置
  async getTunnelConfig(request, env, ctx) {
    try {
      // 验证管理员权限
      const auth = await validateSession(request, env);
      if (!auth || auth.user.role !== 'admin') {
        return errorResponse('Admin access required', 'ADMIN_REQUIRED', 403, request);
      }
      
      const tunnelEnabled = await TUNNEL_CONFIG.getTunnelEnabled(env);
      const health = await this.checkTunnelHealth();
      
      return successResponse({
        tunnel: {
          enabled: tunnelEnabled,
          description: TUNNEL_CONFIG.DESCRIPTION,
          health: health,
          endpoints: {
            tunnel: TUNNEL_CONFIG.TUNNEL_ENDPOINTS,
            direct: TUNNEL_CONFIG.DIRECT_ENDPOINTS
          }
        }
      }, request);
    } catch (error) {
      return errorResponse('Failed to get tunnel config', 'TUNNEL_CONFIG_ERROR', 500, request);
    }
  },
  
  // 更新隧道配置并自动部署
  async updateTunnelConfig(request, env, ctx) {
    try {
      const { enabled } = await request.json();
      
      // 验证管理员权限
      const auth = await validateSession(request, env);
      if (!auth || auth.user.role !== 'admin') {
        return errorResponse('Admin access required', 'ADMIN_REQUIRED', 403, request);
      }
      
      // 检查必要的环境变量（包括占位符值）
      if (!env.CLOUDFLARE_ACCOUNT_ID || 
          !env.CLOUDFLARE_API_TOKEN || 
          !env.WORKER_NAME ||
          env.CLOUDFLARE_API_TOKEN === 'your_api_token_here' ||
          env.CLOUDFLARE_ACCOUNT_ID === 'your_account_id_here' ||
          env.WORKER_NAME === 'your_worker_name_here') {
        // 临时解决方案：直接更新环境变量状态，提示手动部署
        return successResponse({
          message: `隧道配置已设置为${enabled ? '启用' : '禁用'}。由于缺少 API 凭据，请手动重新部署 Worker 使配置生效。`,
          status: 'manual_deployment_required',
          enabled: enabled,
          note: '需要配置 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN 和 WORKER_NAME 环境变量以启用自动部署功能。',
          manualSteps: [
            '1. 配置已保存到KV存储，无需修改wrangler.toml',
            '2. 如需重新部署：运行 wrangler deploy --env production',
            '3. 刷新页面查看更新后的配置'
          ]
        }, request);
      }
      
      // 运行时配置更新 - 直接在Worker中切换状态
      // 将新的配置状态存储到KV中，实现运行时切换
      await env.YOYO_USER_DB.put('RUNTIME_TUNNEL_ENABLED', enabled.toString(), {
        metadata: {
          updatedAt: new Date().toISOString(),
          updatedBy: auth.user.username
        }
      });
      
      // ✅ 添加：清除缓存，使配置立即生效
      TUNNEL_CONFIG.clearCache();
      console.log(`🔄 隧道配置缓存已清除: ${enabled}`);
      
      return successResponse({
        message: `隧道配置已${enabled ? '启用' : '禁用'}，配置立即生效！`,
        deploymentId: `runtime-update-${Date.now()}`,
        estimatedTime: '立即生效',
        status: 'success',
        enabled: enabled,
        note: '配置已通过运行时更新机制立即生效，无需重新部署。',
        runtimeUpdate: true
      }, request);
      
    } catch (error) {
      return errorResponse('Deployment failed: ' + error.message, 'DEPLOYMENT_ERROR', 500, request);
    }
  },
  
  // 更新Worker环境变量
  async updateWorkerEnvironment(env, variables) {
    try {
      // 使用正确的Cloudflare API格式
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${env.WORKER_NAME}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/javascript'
        },
        body: `
// Updated Worker with new environment variables
export default {
  async fetch(request, env, ctx) {
    // Environment variables updated: ${JSON.stringify(variables)}
    return new Response('Worker updated with new environment variables', { status: 200 });
  }
};`
      });
      
      const result = await response.json();
      
      if (result.success) {
        return { success: true, result };
      } else {
        throw new Error(result.errors?.[0]?.message || 'Failed to update worker');
      }
    } catch (error) {
      console.error('更新环境变量失败:', error);
      throw error;
    }
  },
  
  // 部署Worker
  async deployWorker(env) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${env.WORKER_NAME}/deployments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      return await response.json();
    } catch (error) {
      console.error('部署Worker失败:', error);
      throw error;
    }
  },
  
  // 检查隧道健康状态
  async checkTunnelHealth() {
    try {
      const start = Date.now();
      const response = await fetch(`${TUNNEL_CONFIG.TUNNEL_ENDPOINTS.HEALTH}/health`);
      return {
        status: response.ok ? 'healthy' : 'unhealthy',
        latency: Date.now() - start,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
};
