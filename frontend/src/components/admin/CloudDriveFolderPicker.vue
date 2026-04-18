<template>
  <!--
    云盘目录选择器
    使用 Element Plus el-dialog 承载面包屑 + 列表，支持进入子目录、回到上级、加载更多。
    当前仅支持 "我的文件（个人网盘）"，后续按需扩展家庭云/相册 tab。
  -->
  <el-dialog
    v-model="visible"
    title="选择云盘目录"
    width="720px"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    append-to-body
    @close="handleClose"
  >
    <!-- 面包屑：点击非末端条目可回到上级 -->
    <div class="folder-picker-breadcrumb">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item
          v-for="(crumb, idx) in breadcrumbs"
          :key="`${crumb.id}-${idx}`"
        >
          <a
            v-if="idx < breadcrumbs.length - 1"
            href="javascript:void(0)"
            class="breadcrumb-link"
            @click="navigateTo(idx)"
          >{{ crumb.name }}</a>
          <span v-else class="breadcrumb-current">{{ crumb.name }}</span>
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <!-- 首次加载时的友好提示：浏览器冷启动可能需要 20~30 秒 -->
    <el-alert
      v-if="firstLoad && loading"
      title="首次打开云盘浏览需要 20~30 秒，正在连接 139 云盘……"
      type="info"
      :closable="false"
      style="margin-top: 8px;"
    />

    <!-- 目录条目列表 -->
    <el-table
      v-loading="loading"
      element-loading-text="加载中…"
      :data="items"
      height="380px"
      size="small"
      style="margin-top: 12px;"
      highlight-current-row
      empty-text="当前目录为空"
      @row-dblclick="handleRowDoubleClick"
    >
      <el-table-column width="44" align="center">
        <template #default="{ row }">
          <el-icon v-if="row.type === 'folder'" :size="18" color="#E6A23C">
            <Folder />
          </el-icon>
          <el-icon v-else :size="18" color="#909399">
            <Document />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column label="名称" min-width="240">
        <template #default="{ row }">
          <span
            :class="{ 'folder-name-clickable': row.type === 'folder' }"
            @click="row.type === 'folder' && enterFolder(row)"
          >{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90" align="center">
        <template #default="{ row }">
          {{ row.type === 'folder' ? '文件夹' : '文件' }}
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="180">
        <template #default="{ row }">
          {{ formatDate(row.updatedAt) }}
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：139 /hcy/file/list 返回 hasMore + nextCursor 时展示 -->
    <div v-if="hasMore" style="text-align: center; margin-top: 10px;">
      <el-button text :loading="loadingMore" @click="loadMore">
        加载更多
      </el-button>
    </div>

    <template #footer>
      <div class="folder-picker-footer">
        <span class="selected-hint">
          将选中当前目录：<el-tag type="info" size="small">{{ selectedPath }}</el-tag>
        </span>
        <div>
          <el-button :disabled="loading" @click="handleClose">取消</el-button>
          <el-button
            type="primary"
            :disabled="loading"
            @click="handleConfirm"
          >
            选择此目录
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Folder, Document } from '@element-plus/icons-vue';
import axios from '@/utils/axios';

/**
 * 云盘 API 统一前缀。Worker 已同时接受 /api/cloud-drive/*
 * 与 /api/admin/cloud-drive/*，保持与现有组件一致用前者。
 */
const CLOUD_DRIVE_API_PREFIX = '/api/cloud-drive';

/**
 * 根目录的"虚拟条目"：
 * 139 侧 parentFileId='/' 表示个人网盘根目录；前端用本条目让面包屑有一个可见的起点。
 */
const ROOT_FOLDER = Object.freeze({ id: '/', name: '我的文件' });

const props = defineProps({
  /** 弹窗显隐（v-model） */
  modelValue: { type: Boolean, default: false }
});

const emit = defineEmits(['update:modelValue', 'confirm']);

/**
 * 包裹 modelValue 便于模板使用双向绑定
 */
const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

// ================= 状态 =================

/** 当前目录正在首次加载 */
const loading = ref(false);
/** 分页加载更多中 */
const loadingMore = ref(false);
/** 当前列表数据 */
const items = ref([]);
/** 139 是否还有下一页 */
const hasMore = ref(false);
/** 139 分页游标 */
const nextCursor = ref(null);
/** 面包屑栈；最后一项即当前目录 */
const breadcrumbs = ref([{ ...ROOT_FOLDER }]);
/** 标记这次弹窗是否首次 load（用于展示冷启动提示） */
const firstLoad = ref(true);

/**
 * 计算当前目录对象（面包屑末尾）
 */
const currentFolder = computed(() => breadcrumbs.value[breadcrumbs.value.length - 1]);

/**
 * 拼接用于展示/提交的路径字符串
 * 根目录返回 "/"；子级返回 "/A/B"
 */
const selectedPath = computed(() => {
  if (breadcrumbs.value.length <= 1) return '/';
  return '/' + breadcrumbs.value.slice(1).map((b) => b.name).join('/');
});

// ================= 工具 =================

/**
 * 容错地格式化 139 返回的时间字段
 * @param {string|number} value 可能是 "YYYY-MM-DD HH:mm:ss" 或毫秒时间戳
 * @returns {string}
 */
function formatDate(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (/^\d{13}$/.test(String(value))) {
    return new Date(Number(value)).toLocaleString('zh-CN');
  }
  return String(value).slice(0, 19);
}

// ================= 数据拉取 =================

/**
 * 拉取指定父目录下的条目列表
 * @param {string} parentFileId 父目录 fileId（根目录传 '/'）
 * @param {Object} [options]
 * @param {boolean} [options.reset=true] 是否重置列表（默认重置，分页加载时传 false）
 */
async function fetchList(parentFileId, { reset = true } = {}) {
  if (reset) {
    loading.value = true;
    items.value = [];
    hasMore.value = false;
    nextCursor.value = null;
  } else {
    loadingMore.value = true;
  }

  try {
    const response = await axios.get(`${CLOUD_DRIVE_API_PREFIX}/browse/personal`, {
      params: {
        parentFileId,
        pageSize: 50,
        pageCursor: reset ? undefined : nextCursor.value
      },
      // 首次打开浏览器服务冷启动较慢，放宽到 90s
      timeout: 90000
    });

    if (response.data?.status !== 'success') {
      throw new Error(response.data?.message || '加载目录失败');
    }

    const data = response.data.data || {};
    const incoming = Array.isArray(data.items) ? data.items : [];
    items.value = reset ? incoming : [...items.value, ...incoming];
    hasMore.value = !!data.hasMore;
    nextCursor.value = data.nextCursor || null;
    firstLoad.value = false;
  } catch (error) {
    const errCode = error.response?.data?.code;
    if (errCode === 'CLOUD_DRIVE_NOT_LOGGED_IN') {
      ElMessage.error('云盘尚未登录，请先到"云盘登录"中完成扫码');
    } else {
      ElMessage.error(error.response?.data?.message || error.message || '加载目录失败');
    }
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

// ================= 事件处理 =================

/**
 * 进入子目录（仅对 folder 行有效）
 * @param {Object} row 列表行数据
 */
function enterFolder(row) {
  if (row.type !== 'folder' || loading.value) return;
  breadcrumbs.value.push({ id: row.id, name: row.name });
  fetchList(row.id);
}

/**
 * 双击行等同于进入子目录
 */
function handleRowDoubleClick(row) {
  enterFolder(row);
}

/**
 * 点击面包屑回到指定层级
 * @param {number} index 目标层级下标（必须 < 末尾）
 */
function navigateTo(index) {
  if (index < 0 || index >= breadcrumbs.value.length - 1 || loading.value) return;
  breadcrumbs.value = breadcrumbs.value.slice(0, index + 1);
  fetchList(currentFolder.value.id);
}

/**
 * 分页加载更多
 */
function loadMore() {
  if (loadingMore.value || !hasMore.value) return;
  fetchList(currentFolder.value.id, { reset: false });
}

/**
 * 选中"当前目录"并关闭弹窗
 * 触发 confirm 事件，父组件据此回填 manualPath / catalogId
 */
function handleConfirm() {
  emit('confirm', {
    path: selectedPath.value,
    fileId: currentFolder.value.id,
    name: currentFolder.value.name
  });
  visible.value = false;
}

/**
 * 关闭弹窗
 */
function handleClose() {
  visible.value = false;
}

/**
 * 弹窗显隐变化：打开时重置为根目录并拉取列表
 */
watch(() => props.modelValue, (val) => {
  if (val) {
    breadcrumbs.value = [{ ...ROOT_FOLDER }];
    firstLoad.value = true;
    fetchList(ROOT_FOLDER.id);
  }
});
</script>

<style scoped>
.folder-picker-breadcrumb {
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: 4px;
}

.breadcrumb-link {
  color: #409eff;
  text-decoration: none;
}

.breadcrumb-link:hover {
  text-decoration: underline;
}

.breadcrumb-current {
  color: #606266;
  font-weight: 600;
}

.folder-picker-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.selected-hint {
  flex: 1;
  text-align: left;
  font-size: 13px;
  color: #606266;
}

.folder-name-clickable {
  color: #409eff;
  cursor: pointer;
}

.folder-name-clickable:hover {
  text-decoration: underline;
}
</style>
