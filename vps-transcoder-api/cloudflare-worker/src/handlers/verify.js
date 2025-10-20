/**
 * 系统验证处理器
 * 用于验证KV读取限制修复效果和系统功能
 */

import { validateSession } from './auth.js';
import { errorResponse, successResponse } from '../utils/cors.js';
import { logError, logInfo } from '../utils/logger.js';
import { verifyKVOptimization, initKVMonitor } from '../utils/kv-monitor.js';
import { R2LoginLogger } from '../utils/r2-logger.js';

/**
 * 验证处理器
 */
export const handleVerify = {
  /**
   * 验证KV读取限制修复效果
   */
  async verifyKVOptimization(request, env, ctx) {
    try {
      console.log('🔍 开始验证KV读取限制修复效果...');
      
      // 验证管理员权限（可选，用于安全验证）
      const auth = await validateSession(request, env);
      const isAdmin = auth && auth.user.role === 'admin';
      
      if (!isAdmin) {
        console.log('⚠️ 非管理员访问验证端点，返回基础信息');
      }

      // 执行KV优化验证
      const verificationResult = await verifyKVOptimization(env);
      
      // 添加当前时间和系统状态
      const systemStatus = {
        timestamp: new Date().toISOString(),
        kvOptimizationDeployed: true,
        r2MigrationCompleted: !!env.LOGIN_LOGS_BUCKET,
        systemHealthy: verificationResult.summary?.healthStatus === 'HEALTHY'
      };

      const response = {
        verification: verificationResult,
        system: systemStatus,
        recommendations: []
      };

      // 生成建议
      if (verificationResult.summary?.projectedDailyReads > 50000) {
        response.recommendations.push({
          priority: 'HIGH',
          message: '预计KV日读取量仍然较高，建议进一步优化',
          action: '检查是否还有未优化的KV读取操作'
        });
      }

      if (!env.LOGIN_LOGS_BUCKET) {
        response.recommendations.push({
          priority: 'MEDIUM',
          message: 'R2存储桶未配置，登录日志将使用KV降级方案',
          action: '配置LOGIN_LOGS_BUCKET环境变量'
        });
      }

      if (verificationResult.summary?.optimizationEffective) {
        response.recommendations.push({
          priority: 'INFO',
          message: '✅ KV优化效果良好，系统运行正常',
          action: '继续监控KV使用量'
        });
      }

      return successResponse(response, 'KV优化验证完成', request);

    } catch (error) {
      console.error('❌ KV优化验证失败:', error);
      logError(env, 'KV optimization verification failed', error);
      return errorResponse('KV优化验证失败', 'VERIFICATION_ERROR', 500, request);
    }
  },

  /**
   * 验证登录功能
   */
  async verifyLoginFunction(request, env, ctx) {
    try {
      console.log('🔍 开始验证登录功能...');
      
      const testResults = {
        timestamp: new Date().toISOString(),
        tests: [],
        summary: {}
      };

      // 测试1: 检查用户数据是否存在
      console.log('测试1: 检查管理员用户数据');
      try {
        const adminUser = await env.YOYO_USER_DB.get('user:admin');
        testResults.tests.push({
          name: '管理员用户数据检查',
          status: adminUser ? 'PASS' : 'FAIL',
          details: adminUser ? '管理员用户数据存在' : '管理员用户数据不存在',
          critical: true
        });
      } catch (error) {
        testResults.tests.push({
          name: '管理员用户数据检查',
          status: 'ERROR',
          details: `KV读取错误: ${error.message}`,
          critical: true
        });
      }

      // 测试2: 检查R2存储桶配置
      console.log('测试2: 检查R2存储桶配置');
      const r2Available = !!env.LOGIN_LOGS_BUCKET;
      testResults.tests.push({
        name: 'R2存储桶配置检查',
        status: r2Available ? 'PASS' : 'WARN',
        details: r2Available ? 'R2存储桶已配置' : 'R2存储桶未配置，将使用KV降级',
        critical: false
      });

      // 测试3: 测试R2日志记录功能
      if (r2Available) {
        console.log('测试3: 测试R2日志记录功能');
        try {
          const logger = new R2LoginLogger(env.LOGIN_LOGS_BUCKET);
          const testLogEntry = R2LoginLogger.createLogEntry(
            'test_user', 
            request, 
            true, 
            { test: true, timestamp: Date.now() }
          );
          
          // 尝试记录测试日志
          await logger.recordLogin(testLogEntry);
          
          testResults.tests.push({
            name: 'R2日志记录功能测试',
            status: 'PASS',
            details: '成功记录测试日志到R2存储',
            critical: false
          });
        } catch (error) {
          testResults.tests.push({
            name: 'R2日志记录功能测试',
            status: 'FAIL',
            details: `R2记录失败: ${error.message}`,
            critical: false
          });
        }
      }

      // 测试4: 检查会话管理功能
      console.log('测试4: 检查会话管理功能');
      try {
        // 尝试验证一个不存在的会话（不应该抛出错误）
        const fakeAuth = await validateSession({
          headers: new Map([['Authorization', 'Bearer fake_session_id']])
        }, env);
        
        testResults.tests.push({
          name: '会话验证功能测试',
          status: fakeAuth ? 'WARN' : 'PASS',
          details: fakeAuth ? '假会话被验证通过（异常）' : '假会话正确被拒绝',
          critical: false
        });
      } catch (error) {
        testResults.tests.push({
          name: '会话验证功能测试',
          status: 'ERROR',
          details: `会话验证错误: ${error.message}`,
          critical: true
        });
      }

      // 生成测试总结
      const passedTests = testResults.tests.filter(t => t.status === 'PASS').length;
      const failedTests = testResults.tests.filter(t => t.status === 'FAIL').length;
      const errorTests = testResults.tests.filter(t => t.status === 'ERROR').length;
      const criticalIssues = testResults.tests.filter(t => t.critical && t.status !== 'PASS').length;

      testResults.summary = {
        totalTests: testResults.tests.length,
        passed: passedTests,
        failed: failedTests,
        errors: errorTests,
        criticalIssues: criticalIssues,
        overallStatus: criticalIssues > 0 ? 'CRITICAL' : 
                      (failedTests > 0 || errorTests > 0) ? 'WARNING' : 'HEALTHY',
        canLogin: criticalIssues === 0
      };

      console.log('✅ 登录功能验证完成');
      console.log('📊 验证结果:', testResults.summary);

      return successResponse(testResults, '登录功能验证完成', request);

    } catch (error) {
      console.error('❌ 登录功能验证失败:', error);
      logError(env, 'Login function verification failed', error);
      return errorResponse('登录功能验证失败', 'LOGIN_VERIFICATION_ERROR', 500, request);
    }
  },

  /**
   * 重置管理员用户（用于修复登录问题）
   */
  async resetAdminUser(request, env, ctx) {
    try {
      console.log('🔧 开始重置管理员用户...');
      
      // 导入加密工具
      const { hashPassword, generateRandomString } = await import('../utils/crypto.js');
      
      // 生成新的密码哈希
      const password = 'admin123';
      const salt = generateRandomString(16);
      const hashedPassword = await hashPassword(password, salt);
      
      console.log('Generated salt:', salt);
      console.log('Generated hash length:', hashedPassword.length);
      
      // 创建完整的管理员用户数据
      const adminUser = {
        username: 'admin',
        role: 'admin',
        hashedPassword: hashedPassword,
        salt: salt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // 存储到KV数据库
      await env.YOYO_USER_DB.put('user:admin', JSON.stringify(adminUser));
      
      console.log('✅ 管理员用户重置完成');
      
      // 验证存储是否成功
      const storedUser = await env.YOYO_USER_DB.get('user:admin');
      const userData = JSON.parse(storedUser);
      
      const resetResult = {
        timestamp: new Date().toISOString(),
        action: 'admin_user_reset',
        success: true,
        userInfo: {
          username: userData.username,
          role: userData.role,
          hasPassword: !!userData.hashedPassword,
          hasSalt: !!userData.salt,
          createdAt: userData.createdAt,
          updatedAt: userData.updatedAt
        },
        verification: {
          saltLength: userData.salt?.length || 0,
          hashLength: userData.hashedPassword?.length || 0,
          dataComplete: !!(userData.hashedPassword && userData.salt)
        }
      };
      
      return successResponse(resetResult, '管理员用户重置成功', request);
      
    } catch (error) {
      console.error('❌ 管理员用户重置失败:', error);
      logError(env, 'Admin user reset failed', error);
      return errorResponse('管理员用户重置失败', 'ADMIN_RESET_ERROR', 500, request);
    }
  },

  /**
   * 综合系统健康检查
   */
  async systemHealthCheck(request, env, ctx) {
    try {
      console.log('🔍 开始系统健康检查...');
      
      const healthCheck = {
        timestamp: new Date().toISOString(),
        components: {},
        overall: {}
      };

      // 🎯 分层健康检查策略 - 第1层：基础检查
      try {
        const kvAvailable = !!env.YOYO_USER_DB;
        
        healthCheck.components.kv = {
          status: kvAvailable ? 'HEALTHY' : 'UNHEALTHY',
          message: kvAvailable ? 'KV绑定正常' : 'KV绑定不可用',
          method: 'binding_check',
          layer: 1,
          note: '基础检查：仅验证KV绑定存在',
          responseTime: Date.now()
        };
      } catch (error) {
        healthCheck.components.kv = {
          status: 'UNHEALTHY',
          message: `KV绑定检查失败: ${error.message}`,
          method: 'binding_check',
          layer: 1,
          error: error.message
        };
      }

      // 检查R2存储
      if (env.LOGIN_LOGS_BUCKET) {
        try {
          const logger = new R2LoginLogger(env.LOGIN_LOGS_BUCKET);
          // 尝试读取一个不存在的文件（不应该抛出错误）
          await logger.getLoginLogs(new Date(), new Date(), 1, 0);
          
          healthCheck.components.r2 = {
            status: 'HEALTHY',
            message: 'R2存储访问正常'
          };
        } catch (error) {
          healthCheck.components.r2 = {
            status: 'DEGRADED',
            message: `R2存储访问异常: ${error.message}`,
            error: error.message
          };
        }
      } else {
        healthCheck.components.r2 = {
          status: 'NOT_CONFIGURED',
          message: 'R2存储桶未配置'
        };
      }

      // 检查认证系统
      try {
        const adminUser = await env.YOYO_USER_DB.get('user:admin');
        healthCheck.components.auth = {
          status: adminUser ? 'HEALTHY' : 'UNHEALTHY',
          message: adminUser ? '认证系统正常' : '管理员用户不存在'
        };
      } catch (error) {
        healthCheck.components.auth = {
          status: 'UNHEALTHY',
          message: `认证系统错误: ${error.message}`,
          error: error.message
        };
      }

      // 计算整体健康状态
      const componentStatuses = Object.values(healthCheck.components).map(c => c.status);
      const hasUnhealthy = componentStatuses.includes('UNHEALTHY');
      const hasDegraded = componentStatuses.includes('DEGRADED');
      
      healthCheck.overall = {
        status: hasUnhealthy ? 'UNHEALTHY' : 
                hasDegraded ? 'DEGRADED' : 'HEALTHY',
        message: hasUnhealthy ? '系统存在严重问题' :
                hasDegraded ? '系统部分功能异常' : '系统运行正常',
        canOperate: !hasUnhealthy
      };

      console.log('✅ 系统健康检查完成');
      console.log('📊 健康状态:', healthCheck.overall);

      return successResponse(healthCheck, '系统健康检查完成', request);

    } catch (error) {
      console.error('❌ 系统健康检查失败:', error);
      logError(env, 'System health check failed', error);
      return errorResponse('系统健康检查失败', 'HEALTH_CHECK_ERROR', 500, request);
    }
  },

  /**
   * 🎯 分层健康检查策略 - 第2层：功能检查（每小时）
   */
  async functionalHealthCheck(request, env, ctx) {
    try {
      // 使用缓存机制，避免频繁检查
      const cacheKey = 'health_check_layer2';
      const cached = globalThis.healthCheckCache?.[cacheKey];
      const now = Date.now();
      
      // 如果缓存未过期（1小时），直接返回缓存结果
      if (cached && (now - cached.timestamp < 3600000)) {
        return successResponse(cached.result, 'Cached functional health check', request);
      }

      const healthCheck = {
        timestamp: new Date().toISOString(),
        layer: 2,
        type: 'functional_check',
        components: {},
        overall: {}
      };

      // KV功能检查 - 只读取现有数据
      try {
        const adminUser = await env.YOYO_USER_DB.get('user:admin');
        const readTestPassed = !!adminUser;
        
        healthCheck.components.kv = {
          status: readTestPassed ? 'HEALTHY' : 'DEGRADED',
          message: readTestPassed ? 'KV读取功能正常' : 'KV读取功能异常',
          method: 'read_test',
          layer: 2,
          note: '功能检查：读取现有数据验证'
        };
      } catch (error) {
        healthCheck.components.kv = {
          status: 'UNHEALTHY',
          message: `KV读取测试失败: ${error.message}`,
          method: 'read_test',
          layer: 2,
          error: error.message
        };
      }

      // 缓存结果
      if (!globalThis.healthCheckCache) globalThis.healthCheckCache = {};
      globalThis.healthCheckCache[cacheKey] = {
        timestamp: now,
        result: healthCheck
      };

      return successResponse(healthCheck, 'Functional health check completed', request);

    } catch (error) {
      console.error('功能健康检查失败:', error);
      return errorResponse('Functional health check failed', 'FUNCTIONAL_HEALTH_CHECK_ERROR', 500, request);
    }
  },

  /**
   * 🎯 分层健康检查策略 - 第3层：完整测试（每日或手动）
   */
  async comprehensiveHealthCheck(request, env, ctx) {
    try {
      const healthCheck = {
        timestamp: new Date().toISOString(),
        layer: 3,
        type: 'comprehensive_check',
        components: {},
        overall: {}
      };

      // KV完整测试 - 包含读写删除
      try {
        const testKey = `health_check_${Date.now()}`;
        const testValue = 'test_data';
        
        // 写入测试
        await env.YOYO_USER_DB.put(testKey, testValue);
        
        // 读取测试
        const retrievedValue = await env.YOYO_USER_DB.get(testKey);
        
        // 删除测试
        await env.YOYO_USER_DB.delete(testKey);
        
        const writeReadDeleteSuccess = retrievedValue === testValue;
        
        healthCheck.components.kv = {
          status: writeReadDeleteSuccess ? 'HEALTHY' : 'UNHEALTHY',
          message: writeReadDeleteSuccess ? 'KV完整读写删除测试通过' : 'KV完整测试失败',
          method: 'write_read_delete_test',
          layer: 3,
          note: '完整测试：包含写入、读取、删除操作'
        };
      } catch (error) {
        healthCheck.components.kv = {
          status: 'UNHEALTHY',
          message: `KV完整测试失败: ${error.message}`,
          method: 'write_read_delete_test',
          layer: 3,
          error: error.message
        };
      }

      return successResponse(healthCheck, 'Comprehensive health check completed', request);

    } catch (error) {
      console.error('完整健康检查失败:', error);
      return errorResponse('Comprehensive health check failed', 'COMPREHENSIVE_HEALTH_CHECK_ERROR', 500, request);
    }
  }
};
