/**
 * 会话保护管理器
 * 基于COMPLETE_VIDEO_STREAMING_LOGIC.md设计
 * 实现用户会话保护和优雅状态切换
 */

const logger = require('../utils/logger');

class SessionProtectionManager {
  constructor(options = {}) {
    this.activeSessions = new Map(); // 活跃会话
    this.transitionQueue = new Map(); // 状态切换队列
    this.protectionPolicies = new Map(); // 保护策略
    
    // 配置选项
    this.options = {
      sessionTimeout: options.sessionTimeout || 30 * 60 * 1000, // 30分钟会话超时
      heartbeatInterval: options.heartbeatInterval || 30000, // 30秒心跳间隔
      transitionDelay: options.transitionDelay || 5000, // 状态切换延迟
      maxConcurrentTransitions: options.maxConcurrentTransitions || 10,
      ...options
    };
    
    // 启动心跳检查
    this.startHeartbeatMonitor();
  }

  /**
   * 处理代理状态变更
   */
  async handleProxyStateChange(newProxyState, options = {}) {
    try {
      logger.info('开始处理代理状态变更', {
        newProxyState,
        options
      });

      const activeSessions = Array.from(this.activeSessions.values())
        .filter(session => session.isActive);
      
      if (activeSessions.length === 0) {
        // 无活跃会话，直接切换
        const result = await this.directStateSwitch(newProxyState);
        logger.info('无活跃会话，直接切换代理状态', result);
        return { strategy: 'direct_switch', ...result };
      }
      
      // 有活跃会话，执行保护性切换
      return await this.protectedStateTransition(newProxyState, activeSessions, options);
      
    } catch (error) {
      logger.error('处理代理状态变更失败:', error);
      throw error;
    }
  }

  /**
   * 保护性状态切换
   */
  async protectedStateTransition(newState, sessions, options = {}) {
    try {
      const transitionId = `transition_${Date.now()}`;
      
      logger.info('开始保护性状态切换', {
        transitionId,
        newState,
        sessionCount: sessions.length,
        options
      });

      // 1. 检查并发切换限制
      if (this.transitionQueue.size >= this.options.maxConcurrentTransitions) {
        throw new Error('并发状态切换数量超过限制');
      }

      // 2. 添加到切换队列
      this.transitionQueue.set(transitionId, {
        id: transitionId,
        newState,
        sessions: sessions.map(s => s.sessionId),
        startTime: Date.now(),
        status: 'pending',
        options
      });

      // 3. 分析会话保护需求
      const protectionAnalysis = this.analyzeSessionProtection(sessions, newState);
      
      // 4. 通知用户即将优化网络
      if (protectionAnalysis.requiresNotification) {
        await this.notifyNetworkOptimization(sessions, {
          transitionId,
          message: this.getTransitionMessage(newState),
          estimatedTime: protectionAnalysis.estimatedTime
        });
      }

      // 5. 执行分阶段切换
      const transitionResult = await this.executePhaseTransition(
        transitionId, 
        newState, 
        sessions, 
        protectionAnalysis
      );

      // 6. 更新系统状态
      await this.updateSystemState(newState);

      // 7. 清理切换队列
      this.transitionQueue.delete(transitionId);

      logger.info('保护性状态切换完成', {
        transitionId,
        transitionResult,
        affectedSessions: sessions.length
      });

      return { 
        strategy: 'protected_transition', 
        transitionId,
        affectedSessions: sessions.length,
        ...transitionResult
      };
      
    } catch (error) {
      logger.error('保护性状态切换失败:', error);
      
      // 清理失败的切换
      if (transitionId) {
        this.transitionQueue.delete(transitionId);
      }
      
      throw error;
    }
  }

  /**
   * 分析会话保护需求
   */
  analyzeSessionProtection(sessions, newState) {
    const analysis = {
      totalSessions: sessions.length,
      requiresNotification: false,
      requiresGracefulMigration: false,
      estimatedTime: '2-5秒',
      protectionLevel: 'low'
    };

    // 分析会话类型和保护需求
    const videoSessions = sessions.filter(s => s.type === 'video_streaming');
    const manualSelections = sessions.filter(s => s.hasManualChannelSelection);

    if (videoSessions.length > 0) {
      analysis.requiresNotification = true;
      analysis.protectionLevel = 'medium';
      
      if (videoSessions.length > 5) {
        analysis.requiresGracefulMigration = true;
        analysis.protectionLevel = 'high';
        analysis.estimatedTime = '5-10秒';
      }
    }

    if (manualSelections.length > 0) {
      analysis.manualSelections = manualSelections.length;
      analysis.requiresUserChoiceProtection = true;
    }

    logger.info('会话保护需求分析', analysis);
    return analysis;
  }

  /**
   * 执行分阶段切换
   */
  async executePhaseTransition(transitionId, newState, sessions, analysis) {
    const phases = this.getTransitionPhases(analysis);
    const results = [];

    for (const phase of phases) {
      logger.info(`执行切换阶段: ${phase.name}`, {
        transitionId,
        phase: phase.name,
        duration: phase.duration
      });

      try {
        const phaseResult = await this.executeTransitionPhase(
          phase, 
          newState, 
          sessions, 
          analysis
        );
        
        results.push({
          phase: phase.name,
          success: true,
          duration: phaseResult.duration,
          ...phaseResult
        });

        // 阶段间延迟
        if (phase.delay) {
          await this.delay(phase.delay);
        }
        
      } catch (error) {
        logger.error(`切换阶段失败: ${phase.name}`, error);
        
        results.push({
          phase: phase.name,
          success: false,
          error: error.message
        });

        // 根据策略决定是否继续
        if (phase.critical) {
          throw error;
        }
      }
    }

    return {
      phases: results,
      totalDuration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
      successfulPhases: results.filter(r => r.success).length,
      failedPhases: results.filter(r => !r.success).length
    };
  }

  /**
   * 获取切换阶段配置
   */
  getTransitionPhases(analysis) {
    const phases = [
      {
        name: '准备阶段',
        duration: 2000,
        delay: 0,
        critical: false,
        actions: ['通知用户', '预加载新配置', '验证配置可用性']
      }
    ];

    if (analysis.requiresGracefulMigration) {
      phases.push({
        name: '迁移阶段',
        duration: 3000,
        delay: 1000,
        critical: true,
        actions: ['逐个迁移会话', '监控切换状态', '处理异常情况']
      });
    } else {
      phases.push({
        name: '快速切换阶段',
        duration: 1000,
        delay: 500,
        critical: true,
        actions: ['批量更新会话', '同步状态变更']
      });
    }

    phases.push({
      name: '完成阶段',
      duration: 1000,
      delay: 0,
      critical: false,
      actions: ['更新系统状态', '清理旧连接', '确认切换成功']
    });

    return phases;
  }

  /**
   * 执行单个切换阶段
   */
  async executeTransitionPhase(phase, newState, sessions, analysis) {
    const startTime = Date.now();
    
    switch (phase.name) {
      case '准备阶段':
        return await this.executePreparePhase(newState, sessions);
      
      case '迁移阶段':
        return await this.executeMigrationPhase(newState, sessions);
      
      case '快速切换阶段':
        return await this.executeQuickSwitchPhase(newState, sessions);
      
      case '完成阶段':
        return await this.executeCompletionPhase(newState, sessions);
      
      default:
        throw new Error(`未知的切换阶段: ${phase.name}`);
    }
  }

  /**
   * 执行准备阶段
   */
  async executePreparePhase(newState, sessions) {
    // 预加载新配置
    await this.preloadConfiguration(newState);
    
    // 验证配置可用性
    const validationResult = await this.validateConfiguration(newState);
    
    return {
      duration: Date.now() - Date.now(),
      preloaded: true,
      validated: validationResult.isValid,
      sessionsNotified: sessions.length
    };
  }

  /**
   * 执行迁移阶段
   */
  async executeMigrationPhase(newState, sessions) {
    const migrationResults = [];
    
    // 逐个迁移会话
    for (const session of sessions) {
      try {
        if (!session.hasManualChannelSelection) {
          const result = await this.migrateSessionToOptimalChannel(session, newState);
          migrationResults.push({ sessionId: session.sessionId, success: true, ...result });
        } else {
          // 手动选择的会话跳过迁移
          migrationResults.push({ 
            sessionId: session.sessionId, 
            success: true, 
            skipped: true, 
            reason: 'manual_selection_protected' 
          });
        }
      } catch (error) {
        migrationResults.push({ 
          sessionId: session.sessionId, 
          success: false, 
          error: error.message 
        });
      }
    }
    
    return {
      duration: Date.now() - Date.now(),
      migrationResults,
      successfulMigrations: migrationResults.filter(r => r.success).length,
      failedMigrations: migrationResults.filter(r => !r.success).length
    };
  }

  /**
   * 执行快速切换阶段
   */
  async executeQuickSwitchPhase(newState, sessions) {
    // 批量更新会话状态
    const updateResults = await Promise.allSettled(
      sessions.map(session => this.updateSessionState(session, newState))
    );
    
    const successful = updateResults.filter(r => r.status === 'fulfilled').length;
    const failed = updateResults.filter(r => r.status === 'rejected').length;
    
    return {
      duration: Date.now() - Date.now(),
      updatedSessions: successful,
      failedUpdates: failed,
      totalSessions: sessions.length
    };
  }

  /**
   * 执行完成阶段
   */
  async executeCompletionPhase(newState, sessions) {
    // 清理旧连接
    await this.cleanupOldConnections();
    
    // 确认切换成功
    const verificationResult = await this.verifyTransitionSuccess(newState, sessions);
    
    return {
      duration: Date.now() - Date.now(),
      cleaned: true,
      verified: verificationResult.success,
      activeSessions: verificationResult.activeSessions
    };
  }

  /**
   * 创建用户会话
   */
  createSession(sessionInfo) {
    const sessionId = sessionInfo.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const session = {
      sessionId,
      userId: sessionInfo.userId,
      channelId: sessionInfo.channelId,
      type: sessionInfo.type || 'video_streaming',
      isActive: true,
      hasManualChannelSelection: sessionInfo.hasManualChannelSelection || false,
      selectedChannel: sessionInfo.selectedChannel || null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      lastHeartbeat: Date.now(),
      metadata: sessionInfo.metadata || {}
    };
    
    this.activeSessions.set(sessionId, session);
    
    logger.info('创建用户会话', {
      sessionId,
      userId: sessionInfo.userId,
      channelId: sessionInfo.channelId
    });
    
    return session;
  }

  /**
   * 更新会话活动时间
   */
  updateSessionActivity(sessionId, activityInfo = {}) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      session.lastHeartbeat = Date.now();
      
      // 更新额外信息
      if (activityInfo.channelId) {
        session.channelId = activityInfo.channelId;
      }
      
      if (activityInfo.hasManualChannelSelection !== undefined) {
        session.hasManualChannelSelection = activityInfo.hasManualChannelSelection;
      }
      
      if (activityInfo.selectedChannel) {
        session.selectedChannel = activityInfo.selectedChannel;
      }
      
      return true;
    }
    return false;
  }

  /**
   * 移除用户会话
   */
  removeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.activeSessions.delete(sessionId);
      
      logger.info('移除用户会话', {
        sessionId,
        userId: session.userId,
        duration: Date.now() - session.createdAt
      });
      
      return true;
    }
    return false;
  }

  /**
   * 获取活跃会话
   */
  getActiveSessions(filter = {}) {
    const sessions = Array.from(this.activeSessions.values())
      .filter(session => session.isActive);
    
    if (filter.channelId) {
      return sessions.filter(s => s.channelId === filter.channelId);
    }
    
    if (filter.userId) {
      return sessions.filter(s => s.userId === filter.userId);
    }
    
    if (filter.type) {
      return sessions.filter(s => s.type === filter.type);
    }
    
    return sessions;
  }

  /**
   * 启动心跳监控
   */
  startHeartbeatMonitor() {
    setInterval(() => {
      this.checkSessionHeartbeats();
    }, this.options.heartbeatInterval);
    
    logger.info('启动会话心跳监控', {
      interval: this.options.heartbeatInterval
    });
  }

  /**
   * 检查会话心跳
   */
  checkSessionHeartbeats() {
    const now = Date.now();
    const expiredSessions = [];
    
    for (const [sessionId, session] of this.activeSessions) {
      if (now - session.lastHeartbeat > this.options.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }
    
    // 清理过期会话
    expiredSessions.forEach(sessionId => {
      this.removeSession(sessionId);
    });
    
    if (expiredSessions.length > 0) {
      logger.info('清理过期会话', {
        expiredCount: expiredSessions.length,
        remainingCount: this.activeSessions.size
      });
    }
  }

  /**
   * 直接状态切换
   */
  async directStateSwitch(newState) {
    try {
      logger.info('执行直接状态切换', newState);
      
      // 更新系统状态
      await this.updateSystemState(newState);
      
      return {
        success: true,
        switchTime: Date.now(),
        newState
      };
    } catch (error) {
      logger.error('直接状态切换失败:', error);
      throw error;
    }
  }

  /**
   * 通知网络优化
   */
  async notifyNetworkOptimization(sessions, notification) {
    const message = {
      type: 'network_optimization',
      transitionId: notification.transitionId,
      title: '网络连接优化',
      message: notification.message,
      estimatedTime: notification.estimatedTime,
      timestamp: Date.now()
    };
    
    logger.info('通知用户网络优化', {
      sessionCount: sessions.length,
      notification: message
    });
    
    // 发送通知给所有会话
    for (const session of sessions) {
      try {
        await this.sendSessionNotification(session.sessionId, message);
      } catch (error) {
        logger.error(`发送通知失败 ${session.sessionId}:`, error);
      }
    }
  }

  /**
   * 发送会话通知
   */
  async sendSessionNotification(sessionId, message) {
    // 这里应该通过WebSocket或其他实时通信方式发送
    logger.info(`发送会话通知 ${sessionId}`, message);
    return { success: true, sessionId, message };
  }

  /**
   * 获取切换消息
   */
  getTransitionMessage(newState) {
    if (newState.proxyEnabled) {
      return '正在启用网络加速，优化您的观看体验';
    } else {
      return '正在调整网络配置，确保连接稳定';
    }
  }

  /**
   * 预加载配置
   */
  async preloadConfiguration(newState) {
    // 模拟预加载配置
    await this.delay(500);
    return { preloaded: true, newState };
  }

  /**
   * 验证配置
   */
  async validateConfiguration(newState) {
    // 模拟配置验证
    await this.delay(300);
    return { isValid: true, newState };
  }

  /**
   * 迁移会话到最佳通道
   */
  async migrateSessionToOptimalChannel(session, newState) {
    // 模拟会话迁移
    await this.delay(200);
    return { migrated: true, sessionId: session.sessionId, newState };
  }

  /**
   * 更新会话状态
   */
  async updateSessionState(session, newState) {
    // 更新会话的网络状态
    session.networkState = newState;
    session.lastUpdated = Date.now();
    return { updated: true, sessionId: session.sessionId };
  }

  /**
   * 更新系统状态
   */
  async updateSystemState(newState) {
    // 这里应该更新实际的系统状态
    logger.info('更新系统状态', newState);
    await this.delay(100);
    return { updated: true, newState };
  }

  /**
   * 清理旧连接
   */
  async cleanupOldConnections() {
    // 清理过期的连接和资源
    await this.delay(200);
    return { cleaned: true };
  }

  /**
   * 验证切换成功
   */
  async verifyTransitionSuccess(newState, sessions) {
    // 验证所有会话的状态
    const activeSessions = sessions.filter(s => this.activeSessions.has(s.sessionId));
    
    return {
      success: true,
      activeSessions: activeSessions.length,
      newState
    };
  }

  /**
   * 延迟函数
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const now = Date.now();
    const sessions = Array.from(this.activeSessions.values());
    
    return {
      totalSessions: this.activeSessions.size,
      activeSessions: sessions.filter(s => s.isActive).length,
      videoSessions: sessions.filter(s => s.type === 'video_streaming').length,
      manualSelections: sessions.filter(s => s.hasManualChannelSelection).length,
      activeTransitions: this.transitionQueue.size,
      averageSessionDuration: sessions.length > 0 
        ? sessions.reduce((sum, s) => sum + (now - s.createdAt), 0) / sessions.length 
        : 0,
      lastActivity: sessions.length > 0 
        ? Math.max(...sessions.map(s => s.lastActivity)) 
        : 0
    };
  }
}

module.exports = SessionProtectionManager;
