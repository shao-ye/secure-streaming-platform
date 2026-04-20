<template>
  <!--
    云盘目录选择器
    使用 Element Plus el-dialog + el-tabs 承载两个顶级入口：
      - 我的文件（个人网盘，/hcy/file/list，可多级进入 / 分页加载）
      - 我的家庭（家庭云，orchestration 接口，两级：家庭列表 → 家庭相册）
    说明：
      1. "我的家庭"当前仅支持浏览，保存/上传执行尚未接入，因此该 Tab 下
         底部的"选择此目录"按钮会被禁用，并以 tooltip 告知用户。
      2. 两个 Tab 的 state 完全独立，切换不重置对方的浏览位置。
  -->
  <el-dialog
    v-model="visible"
    title="选择云盘目录"
    width="760px"
    :close-on-click-modal="false"
    :close-on-press-escape="!anyLoading"
    append-to-body
    @close="handleClose"
  >
    <el-tabs v-model="activeTab" class="folder-picker-tabs" @tab-change="handleTabChange">
      <!-- ========================== Tab 1: 我的文件 ========================== -->
      <el-tab-pane label="我的文件" name="personal">
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
      </el-tab-pane>

      <!-- ========================== Tab 2: 我的家庭 ========================== -->
      <el-tab-pane label="我的家庭" name="family">
        <!-- 顶部提示：不同层级的操作提示 -->
        <el-alert
          :title="familyActionHint"
          type="info"
          :closable="false"
          style="margin-bottom: 8px;"
        />

        <!-- 面包屑：我的家庭 → <家庭名> -->
        <div class="folder-picker-breadcrumb">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item
              v-for="(crumb, idx) in familyBreadcrumbs"
              :key="`family-${crumb.id}-${idx}`"
            >
              <a
                v-if="idx < familyBreadcrumbs.length - 1"
                href="javascript:void(0)"
                class="breadcrumb-link"
                @click="navigateFamilyTo(idx)"
              >{{ crumb.name }}</a>
              <span v-else class="breadcrumb-current">{{ crumb.name }}</span>
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <!-- 首次加载时的友好提示：与个人网盘共用一个 Playwright 浏览器，冷启动仍较慢 -->
        <el-alert
          v-if="familyFirstLoad && familyLoading"
          title="首次打开家庭云需要 20~30 秒，正在连接 139 云盘……"
          type="info"
          :closable="false"
          style="margin-top: 8px;"
        />

        <!-- 家庭 / 相册列表 -->
        <el-table
          v-loading="familyLoading"
          element-loading-text="加载中…"
          :data="familyItems"
          height="340px"
          size="small"
          style="margin-top: 12px;"
          highlight-current-row
          :empty-text="familyEmptyText"
          @row-dblclick="handleFamilyRowDoubleClick"
        >
          <el-table-column width="44" align="center">
            <template #default="{ row }">
              <el-icon
                v-if="row.type === 'family'"
                :size="18"
                color="#409EFF"
              >
                <HomeFilled />
              </el-icon>
              <el-icon
                v-else-if="row.type === 'album'"
                :size="18"
                color="#E6A23C"
              >
                <Picture />
              </el-icon>
              <el-icon v-else :size="18" color="#909399">
                <Folder />
              </el-icon>
            </template>
          </el-table-column>
          <el-table-column label="名称" min-width="240">
            <template #default="{ row }">
              <!--
                名称行为：
                  - family 行：点击进入相册列表（下钻）
                  - album 行：点击选中相册，选中后可选为上传目标
                被选中的 album 在名字旁边显示「已选中」小标，便于用户识别。
              -->
              <span
                :class="{ 'folder-name-clickable': canInteractFamilyRow(row) }"
                @click="canInteractFamilyRow(row) && onFamilyRowNameClick(row)"
              >{{ row.name }}</span>
              <el-tag
                v-if="row.type === 'album' && isFamilyRowSelected(row)"
                size="small"
                type="success"
                effect="dark"
                style="margin-left: 8px;"
              >
                已选中
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90" align="center">
            <template #default="{ row }">
              {{ familyRowTypeLabel(row) }}
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatDate(row.updatedAt) }}
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <div class="folder-picker-footer">
        <span class="selected-hint">
          将选中当前目录：<el-tag :type="confirmTagType" size="small">{{ selectedPath }}</el-tag>
        </span>
        <div>
          <el-button :disabled="anyLoading" @click="handleClose">取消</el-button>
          <!--
            "选择此目录" 禁用条件分解：
              - personal tab：加载中时禁用
              - family tab：需要已选中某个相册（familySelectedAlbum 有值）
                * 未选中时 tooltip 提示 "请先点击列表中的相册"
                * 选中后 tooltip 显示已选择的完整路径
          -->
          <el-tooltip
            v-if="activeTab === 'family' && !familySelectedAlbum"
            content="请先进入某个家庭并点击列表中的相册"
            placement="top"
          >
            <span>
              <el-button type="primary" disabled>
                选择此目录
              </el-button>
            </span>
          </el-tooltip>
          <el-button
            v-else
            type="primary"
            :disabled="confirmDisabled"
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
import { Folder, Document, HomeFilled, Picture } from '@element-plus/icons-vue';
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

/**
 * 家庭云的根虚拟条目：
 * 家庭云 / 相册接口的 cloudID/photoID 由 139 动态返回，根节点没有固定 ID。
 * 这里用一个常量字符串作为面包屑起点，导航层级 0 表示 "家庭列表"，1 表示 "某家庭的相册列表"。
 */
const FAMILY_ROOT = Object.freeze({ id: '__family_root__', name: '我的家庭' });

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

// ================= 状态：Tab 切换 =================

/**
 * 当前激活 Tab：'personal' | 'family'
 * 两个 Tab 的 state 完全独立，切换不重置对方
 */
const activeTab = ref('personal');

// ================= 状态：我的文件（个人网盘） =================

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

// ================= 状态：我的家庭（家庭云） =================

/** 家庭 tab 首次加载（用于展示冷启动提示） */
const familyFirstLoad = ref(true);
/** 家庭 tab 加载中 */
const familyLoading = ref(false);
/** 家庭 tab 面包屑栈：L0=我的家庭，L1=某家庭 */
const familyBreadcrumbs = ref([{ ...FAMILY_ROOT }]);
/** 家庭 tab 当前列表条目：type='family'（家庭） 或 'album'（相册） */
const familyItems = ref([]);

/**
 * 当前在家庭 tab 中选中的相册对象（下钻到某家庭后可选中其中一个相册作为上传目标）。
 * 结构：{ id, name, cloudId }
 * — 当面包屑返回 L0 或切换家庭时应清空。
 * — 未选中时 "选择此目录" 按钮禁用。
 */
const familySelectedAlbum = ref(null);

/**
 * 计算当前目录对象（面包屑末尾）
 */
const currentFolder = computed(() => breadcrumbs.value[breadcrumbs.value.length - 1]);

/**
 * 任一 tab 正在加载的聚合标志，用于控制 dialog 的 escape 关闭/取消按钮
 */
const anyLoading = computed(() => loading.value || loadingMore.value || familyLoading.value);

/**
 * 家庭 tab 空态文案：根据面包屑深度决定
 *   - 深度 1（刚进 tab）："当前账号下未找到家庭"
 *   - 深度 2（进入某家庭后）："该家庭下暂无相册"
 */
const familyEmptyText = computed(() => (
  familyBreadcrumbs.value.length >= 2 ? '该家庭下暂无相册' : '当前账号下未找到家庭'
));

/**
 * 家庭 tab 操作提示文案：根据面包屑深度动态提示下一步操作
 *   - L0（家庭列表）："点击家庭名称进入家庭查看相册"
 *   - L1（某家庭下的相册列表）："点击相册名称选中，然后点击底部「选择此目录」"
 */
const familyActionHint = computed(() => (
  familyBreadcrumbs.value.length >= 2
    ? '点击相册名称选中其为上传目标，然后点击底部「选择此目录」。'
    : '点击家庭名称进入家庭查看其下相册。'
));

/**
 * 拼接用于展示/提交的路径字符串（根据 activeTab 动态）
 * - personal: 根目录 "/"，子级 "/A/B"
 * - family:   "/我的家庭" / "/我的家庭/家庭名" / "/我的家庭/家庭名/相册名"
 *   — 进入某家庭并选中了某相册时，路径末尾追加相册名，方便用户识别
 */
const selectedPath = computed(() => {
  if (activeTab.value === 'family') {
    if (familyBreadcrumbs.value.length === 0) return '/';
    const crumbPath = '/' + familyBreadcrumbs.value.map((b) => b.name).join('/');
    if (familySelectedAlbum.value && familyBreadcrumbs.value.length >= 2) {
      return `${crumbPath}/${familySelectedAlbum.value.name}`;
    }
    return crumbPath;
  }
  if (breadcrumbs.value.length <= 1) return '/';
  return '/' + breadcrumbs.value.slice(1).map((b) => b.name).join('/');
});

/**
 * 底部路径标签的视觉类型：不同 Tab / 状态色调不同
 *   - personal: info（蓝灰）
 *   - family 且已选中相册：success（绿，意味可确认）
 *   - family 未选中：warning（橙，提醒尚未选中）
 */
const confirmTagType = computed(() => {
  if (activeTab.value !== 'family') return 'info';
  return familySelectedAlbum.value ? 'success' : 'warning';
});

/**
 * "选择此目录"按钮的禁用状态
 * 注：family tab + 未选中的条件已在模板中用 el-tooltip 代替这里的禁用（让 tooltip 生效）
 * 这里只盖盖 loading 时禁用。
 */
const confirmDisabled = computed(() => {
  if (activeTab.value === 'family') return familyLoading.value;
  return loading.value;
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
 * - personal tab：emit { destinationType:'cloudFile', path, fileId, name } — 保持向后兼容
 * - family   tab：emit { destinationType:'familyAlbum', path, cloudId, albumId, albumName, familyName } —
 *             用于父组件 ChannelConfigDialog 将家庭相册作为上传目标回填到表单
 */
function handleConfirm() {
  if (activeTab.value === 'personal') {
    emit('confirm', {
      destinationType: 'cloudFile',
      path: selectedPath.value,
      fileId: currentFolder.value.id,
      name: currentFolder.value.name
    });
    visible.value = false;
    return;
  }

  // family tab：需已选中相册
  if (!familySelectedAlbum.value) return;
  // L1 的面包屑单元素是家庭本身
  const familyCrumb = familyBreadcrumbs.value[1] || null;
  emit('confirm', {
    destinationType: 'familyAlbum',
    path: selectedPath.value,
    cloudId: familyCrumb?.id || familySelectedAlbum.value.cloudId || '',
    familyName: familyCrumb?.name || '',
    albumId: familySelectedAlbum.value.id,
    albumName: familySelectedAlbum.value.name
  });
  visible.value = false;
}

// ================= 家庭云浏览 =================

/**
 * 判断家庭 tab 当前行是否可以交互（点击）：
 * - family 行可点击（进入相册列表）
 * - album  行可点击（选中相册）
 * - 加载中暂不允许交互
 */
function canInteractFamilyRow(row) {
  if (!row || familyLoading.value) return false;
  return row.type === 'family' || row.type === 'album';
}

/**
 * 判断某个相册行是否为当前已选中的相册（用于展示"已选中"标签）
 */
function isFamilyRowSelected(row) {
  return !!(familySelectedAlbum.value && row?.type === 'album' && row.id === familySelectedAlbum.value.id);
}

/**
 * 家庭 tab 行名称点击分发：
 * - family 行 → 进入相册列表（并清空之前的相册选中）
 * - album  行 → 选中 / 取消选中相册
 */
function onFamilyRowNameClick(row) {
  if (!canInteractFamilyRow(row)) return;
  if (row.type === 'family') {
    enterFamilyRow(row);
  } else if (row.type === 'album') {
    // 已选中再点视为取消选中，方便用户试错
    if (familySelectedAlbum.value?.id === row.id) {
      familySelectedAlbum.value = null;
    } else {
      // L1 的面包屑末尾是当前家庭，id 即 cloudId
      const familyCrumb = familyBreadcrumbs.value[1];
      familySelectedAlbum.value = {
        id: row.id,
        name: row.name,
        cloudId: familyCrumb?.id || row.cloudId || ''
      };
    }
  }
}

/**
 * 家庭 tab 行的中文类型标签
 */
function familyRowTypeLabel(row) {
  if (!row) return '-';
  if (row.type === 'family') return '家庭';
  if (row.type === 'album') return '相册';
  return '条目';
}

/**
 * 拉取当前账号下的家庭列表（家庭云 L0）
 * 调用后端 GET /api/cloud-drive/browse/family；orchestration 接口冷启动可能较慢
 */
async function fetchFamilyRoot() {
  familyLoading.value = true;
  familyItems.value = [];
  try {
    const response = await axios.get(`${CLOUD_DRIVE_API_PREFIX}/browse/family`, {
      // 冷启动同样可能需要较长时间，复用 90s 超时
      timeout: 90000
    });
    if (response.data?.status !== 'success') {
      throw new Error(response.data?.message || '加载家庭列表失败');
    }
    const families = Array.isArray(response.data.data?.families) ? response.data.data.families : [];
    familyItems.value = families.map((f) => ({
      id: f.id,
      name: f.name || '未命名家庭',
      type: 'family',
      updatedAt: f.updatedAt || f.createdAt
    }));
    familyFirstLoad.value = false;
  } catch (error) {
    const errCode = error.response?.data?.code;
    if (errCode === 'CLOUD_DRIVE_NOT_LOGGED_IN') {
      ElMessage.error('云盘尚未登录，请先到"云盘登录"中完成扫码');
    } else {
      ElMessage.error(error.response?.data?.message || error.message || '加载家庭列表失败');
    }
  } finally {
    familyLoading.value = false;
  }
}

/**
 * 拉取指定家庭下的相册列表（家庭云 L1）
 * @param {string} cloudId 家庭 ID（后端 family 返回的 id）
 */
async function fetchFamilyAlbums(cloudId) {
  familyLoading.value = true;
  familyItems.value = [];
  try {
    const response = await axios.get(`${CLOUD_DRIVE_API_PREFIX}/browse/family-albums`, {
      params: { cloudId },
      timeout: 90000
    });
    if (response.data?.status !== 'success') {
      throw new Error(response.data?.message || '加载家庭相册失败');
    }
    const albums = Array.isArray(response.data.data?.albums) ? response.data.data.albums : [];
    familyItems.value = albums.map((a) => ({
      id: a.id,
      name: a.name || '未命名相册',
      type: 'album',
      updatedAt: a.updatedAt || a.createdAt,
      cloudId: a.cloudId
    }));
  } catch (error) {
    const errCode = error.response?.data?.code;
    if (errCode === 'CLOUD_DRIVE_NOT_LOGGED_IN') {
      ElMessage.error('云盘尚未登录，请先到"云盘登录"中完成扫码');
    } else {
      ElMessage.error(error.response?.data?.message || error.message || '加载家庭相册失败');
    }
  } finally {
    familyLoading.value = false;
  }
}

/**
 * 进入家庭 tab 某一行的下一级
 * 目前仅 family -> album（二级）；album 为终点不下钻
 * 进入新家庭时应清空之前的相册选中（跨家庭选中无义）
 * @param {Object} row 表格行
 */
function enterFamilyRow(row) {
  if (!row || familyLoading.value) return;
  if (row.type === 'family') {
    familySelectedAlbum.value = null;
    familyBreadcrumbs.value.push({ id: row.id, name: row.name });
    fetchFamilyAlbums(row.id);
  }
}

/**
 * 家庭 tab 双击行：
 * - family 行：进入下一级
 * - album  行：选中并直接确认（提供“双击快捷选择”的体验）
 */
function handleFamilyRowDoubleClick(row) {
  if (!row) return;
  if (row.type === 'family') {
    enterFamilyRow(row);
  } else if (row.type === 'album') {
    // 先确保已选中，再触发确认
    const familyCrumb = familyBreadcrumbs.value[1];
    familySelectedAlbum.value = {
      id: row.id,
      name: row.name,
      cloudId: familyCrumb?.id || row.cloudId || ''
    };
    handleConfirm();
  }
}

/**
 * 家庭 tab 面包屑点击返回上层
 * 返回任何上层都应清空相册选中（改变上下文后之前的选中不再成立）
 * @param {number} index 目标层级下标（必须 < 末尾）
 */
function navigateFamilyTo(index) {
  if (index < 0 || index >= familyBreadcrumbs.value.length - 1 || familyLoading.value) return;
  familyBreadcrumbs.value = familyBreadcrumbs.value.slice(0, index + 1);
  familySelectedAlbum.value = null;
  if (index === 0) {
    // 返回到 L0：重新拉家庭列表
    fetchFamilyRoot();
  } else {
    // 理论上目前最多 2 层，不会走到这里；留作将来扩展
    const target = familyBreadcrumbs.value[index];
    if (target) fetchFamilyAlbums(target.id);
  }
}

/**
 * Tab 切换回调：切到 family 且尚未加载过时，拉一次家庭列表
 * @param {string} tabName 新激活的 tab name
 */
function handleTabChange(tabName) {
  if (tabName === 'family' && familyItems.value.length === 0 && !familyLoading.value) {
    fetchFamilyRoot();
  }
}

/**
 * 关闭弹窗
 */
function handleClose() {
  visible.value = false;
}

/**
 * 弹窗显隐变化：打开时重置两个 Tab 的状态
 * - 默认激活 personal，立即拉取根目录列表
 * - family 状态也重置，但不主动拉取，等用户切到该 Tab 再按需加载，节省一次 API 调用
 */
watch(() => props.modelValue, (val) => {
  if (val) {
    activeTab.value = 'personal';
    // 重置 personal
    breadcrumbs.value = [{ ...ROOT_FOLDER }];
    firstLoad.value = true;
    fetchList(ROOT_FOLDER.id);
    // 重置 family（懒加载）
    familyBreadcrumbs.value = [{ ...FAMILY_ROOT }];
    familyItems.value = [];
    familyFirstLoad.value = true;
    familySelectedAlbum.value = null;
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

/* el-tabs 与 dialog 内容之间的间距微调 */
.folder-picker-tabs {
  margin-top: -6px;
}
</style>
