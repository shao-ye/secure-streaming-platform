<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script>
export default {
  name: 'App'
}
</script>

<style>
/* 全局样式重置和移动端优化 */
* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html {
  font-size: 16px;
  -webkit-text-size-adjust: 100%;
  -ms-text-size-adjust: 100%;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: #303133;
  background-color: #f5f7fa;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}

#app {
  height: 100vh;
  overflow: hidden;
  position: relative;
}

/* 移动端优化 */
@media (max-width: 767px) {
  html {
    font-size: 14px;
  }
  
  body {
    font-size: 14px;
    line-height: 1.5;
  }
  
  /* 防止iOS Safari底部工具栏影响视口高度 */
  #app {
    height: 100vh;
    height: -webkit-fill-available;
  }
}

/* 平板端优化 */
@media (min-width: 768px) and (max-width: 1024px) {
  html {
    font-size: 15px;
  }
}

/* 触摸设备优化 */
@media (hover: none) and (pointer: coarse) {
  /* 增加触摸目标大小 */
  button, 
  .el-button,
  [role="button"] {
    min-height: 44px;
    min-width: 44px;
  }
  
  /* 优化输入框 */
  input,
  textarea,
  .el-input__inner {
    font-size: 16px; /* 防止iOS缩放 */
  }
}

/* 滚动条优化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

/* 移动端滚动条隐藏 */
@media (max-width: 767px) {
  ::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
}

/* 焦点样式优化 */
button:focus,
.el-button:focus {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

/* 高对比度模式支持 */
@media (prefers-contrast: high) {
  body {
    background-color: #ffffff;
    color: #000000;
  }
}

/* 暗色模式支持 */
@media (prefers-color-scheme: dark) {
  body {
    background-color: #1a1a1a;
    color: #e4e7ed;
  }
}

/* 减少动画模式 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Element Plus 组件移动端优化 */
@media (max-width: 767px) {
  .el-dialog {
    width: 95% !important;
    margin: 0 auto !important;
  }
  
  .el-message-box {
    width: 90% !important;
  }
  
  .el-drawer {
    width: 100% !important;
  }
  
  .el-popover {
    max-width: calc(100vw - 32px) !important;
  }
}

/* 安全区域适配 (iPhone X+) */
@supports (padding: max(0px)) {
  body {
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  
  @media (max-width: 767px) {
    #app {
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
}

/* 防止文本选择 (移动端) */
@media (max-width: 767px) {
  .no-select,
  button,
  .el-button {
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
}

/* 加载动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from {
  transform: translateX(-100%);
}

.slide-leave-to {
  transform: translateX(100%);
}
</style>
