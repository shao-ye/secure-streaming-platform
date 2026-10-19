# 频道录制分段与文件命名规则

> 原设计创建于 2025-10-29；本版说明 2026-10-19 在基线 `66e5339` 上完成的录制生命周期修复，部署状态与目标环境验收以对应发布记录为准。
> 本文是录制分段、命名和收尾逻辑的现行阅读入口。描述的是代码行为，不代表已核实线上配置、部署版本、视频完整性或播放效果。旧实施记录中的部署和验收结果只属于其记录日期。

## 1. 配置与生效时机

| 项目 | 当前规则 |
| --- | --- |
| 配置入口 | 管理后台系统设置中的“录制分段配置” |
| 配置接口 | `GET / PUT /api/admin/cleanup/config` |
| KV 存储 | `YOYO_USER_DB` 中的 `system:cleanup:config` |
| 分段开关 | `segmentEnabled`，默认 `false` |
| 分段时长 | `segmentDuration`，单位分钟，默认 `60`，前端和 Worker 限制为 `3～240` |
| 配置范围 | 全局设置；`RecordScheduler.startRecording()` 读取后覆盖频道参数中的两个分段字段 |
| 生效时机 | 下一次启动录制时读取；保存全局设置不会重新构建已经运行的 FFmpeg 命令 |

下一次启动包括计划启动、服务重启后的录制启动，以及调度器执行停止后重新启动的恢复流程。不要把“无需重启整个服务”理解为“正在录制的进程立即改变分段时长”。获取系统设置失败时，调度器代码回退为关闭分段、60 分钟。

源代码：[系统设置 UI](../../frontend/src/components/admin/SystemSettingsDialog.vue)、[Worker 配置接口](../../cloudflare-worker/src/index.js)、[默认设置](../../cloudflare-worker/src/handlers/cloudDriveHandler.js)、[RecordScheduler](../../vps-server/src/services/RecordScheduler.js) 的 `fetchSystemSettings()` / `startRecording()`。

## 2. FFmpeg 如何分段

`SimpleStreamManager.spawnFFmpegWithRecording()` 在同一个录制 FFmpeg 进程中输出 HLS 和 MP4。分段开启时，录制输出使用以下参数；这只是相关参数摘录，不是完整可执行命令：

```text
-f segment
-segment_time <segmentDuration × 60>
-segment_format mp4
-segment_format_options movflags=+frag_keyframe+empty_moov+default_base_moof:flush_packets=1
-reset_timestamps 1
-y <录制临时文件模式>
```

- 分段按配置的时长交给 FFmpeg 处理，当前命令没有启用 `segment_atclocktime` 整点切分。
- 一次分段切换不需要应用重启录制进程；开启或关闭整个录制输出时则可能重启进程。
- 当前录制视频使用 `libx264` / `ultrafast`，禁用音频；后续重封装才使用 `-c copy`。
- 录制时采用 fragmented MP4，完成段再尝试转换为标准 MP4。分段输出设置 `flush_packets=1`，单文件输出设置 `-flush_packets 1`，减少低码率视频长时间缓冲在内存中、文件仅有头部而看不到增长的情况。
- 各段作为独立文件保存，没有将它们合并为整场文件的步骤。
- `segment_time` 是切分参数；命名中的配置时长计算不能证明媒体边界恰好落在该秒，也不能证明无丢帧、无卡顿。

源代码：[SimpleStreamManager](../../vps-server/src/services/SimpleStreamManager.js) 的 `spawnFFmpegWithRecording()`。

## 3. 目录与频道名称

```text
{录制根目录}/{频道ID}/{YYYYMMDD}/{文件名}.mp4
```

录制根目录优先取 `recordConfig.storagePath`，否则取 manager 的 `recordingBaseDir`。后者依次读取 `RECORDINGS_PATH`、`RECORDINGS_BASE_DIR`，最后回退为 `/var/www/recordings`。正常录制的根目录不能固定套用历史部署示例 `/srv/filebrowser/yoyo-k`；恢复服务另有这个兜底值，目录选择方式见[恢复说明](RECORDING_RECOVERY_IMPLEMENTATION.md)。

频道名称由 `resolveRecordingChannelName()` 处理，优先采用频道配置接口返回的名称，再按代码中的回退逻辑取值。目录使用频道 ID，文件名同时保留名称和 ID。

`_createRecordingSession()` 为本次会话固定 `sessionStartTime`，`generateRecordingPath()` 用同一时间按显式 UTC+8 生成目录和文件名。FFmpeg 输出模板在启动时确定，普通段与退出收尾均使用该会话模板，跨午夜也继续定位原目录。

## 4. 临时文件与正式文件

### 4.1 分段录制临时名

```text
{频道名}_{频道ID}_{YYYYMMDD}_{本次路径生成HHMMSS}_temp_%03d.mp4
```

例如同一次录制生成：

```text
示例教室1_stream_example1_20261019_074001_temp_000.mp4
示例教室1_stream_example1_20261019_074001_temp_001.mp4
示例教室1_stream_example1_20261019_074001_temp_002.mp4
```

`074001` 是本次录制生成路径时的北京时间，同一录制会话各段共用；它不是每一段各自的开始时间。末尾编号区分各段。无 HHMMSS 的旧格式只作为历史文件兼容处理，当前新录制不生成该格式。

秒级文件名格式保持不变。同一进程内的频道锁会串行创建会话；若同秒已经使用过，或目录中已存在相同会话前缀的文件，就等待下一秒重新选取时间。正式录制文件发布另用排他硬链接防覆盖。该机制不替代多个独立进程同时写同一录制目录时的协调。

### 4.2 分段正式名

```text
{频道名}_{频道ID}_{YYYYMMDD}_{段开始HHMMSS}_to_{段结束HHMMSS}.mp4
```

示例：

```text
示例教室1_stream_example1_20261019_074001_to_084001.mp4
```

日期采用 8 位，时间采用 6 位。正式名的起止时间由处理场景决定，见第 5 节。频道名称和 ID 可能含下划线，读取文件名时不能简单按固定下划线位置拆分。

### 4.3 单文件模式

关闭分段后，仍先写入带临时标识的文件，但不启用 segment muxer，也不会按配置时长切分：

```text
{频道名}_{频道ID}_{YYYYMMDD}_{本次会话HHMMSS}_temp_000.mp4
```

`000` 是单文件模式的固定后缀，不表示已启用分段。该名称让上传扫描器继续将正在写入的文件排除在正式产物之外，替代旧实现录制一开始就写 `_to_{计划结束时间}.mp4` 的行为。

正常停止和非预期退出均先等待该会话子进程的 `close`，再由 `renameRecordingWithActualEndTime()` 保留文件名中的开始时间，并使用记录的退出时刻按北京时间形成 `_to_{实际结束HHMMSS}.mp4`。命名不读取视频时长或 mtime；文件发布则调用与分段相同的 `SegmentFinalizer`，完成重封装和媒体校验后才排他发布正式名，并派发完成事件。失败保留 temp，不把尚未通过校验的文件直接改成正式名。

如果服务异常中断而未执行收尾，这个 `temp_000` 文件可被恢复服务按普通遗留 temp 识别；恢复起止时间仍采用第 5 节的 `mtime - 视频时长` 算法。

## 5. 起止时间的计算规则

下表中的段号 `i` 是临时文件的分段编号，不是扫描结果中的数组位置。

| 处理场景 | 开始时间 | 结束时间 | 时间格式化 |
| --- | --- | --- | --- |
| 正常切换后处理上一段：`renameCompletedSegment()` | `sessionStartTime + i × segmentDuration` | 该段开始 + `segmentDuration` | 显式 UTC+8 |
| 停止或进程退出时处理本会话剩余文件：`renameFinalSegment()` | 本会话固定 `sessionStartTime + i × segmentDuration` | 最高剩余段用本次退出时刻；其余剩余段按配置时长推算结束 | 显式 UTC+8 |
| 单文件停止或进程退出：`renameRecordingWithActualEndTime()` | 原临时名中的本次会话时间 | 本次退出时刻 | 显式 UTC+8 |
| 恢复服务处理遗留临时文件：`renameTempFile()` | `mtime - ffprobe 视频时长` | 文件 `mtime` | `getHours()` 等环境本地时间方法 |

公式中的 `segmentDuration` 需由分钟换算为对应的毫秒。普通分段的文件名仍按会话时间与配置时长推算；安全重封装会用 ffprobe 校验输入、输出时长，但不以此改写普通段命名。异常恢复仍单独用媒体时长和 mtime 反推时间。

恢复路径沿用临时名中的日期和原目录。新临时名中的时间用于对比告警：与反推开始时间相差超过 60 秒会记录警告，正式名仍使用反推值。恢复使用本地时区；本版 PM2 的 `env_production` 显式设置 `TZ=Asia/Shanghai`，按生产配置启动时使用北京时间，绕过该配置启动仍需核实实际时区。

以正常段会话开始 `07:40:01`、配置 60 分钟为例，段号 0、1 的命名区间分别推算为 `07:40:01～08:40:01`、`08:40:01～09:40:01`。这说明命名算法，不是媒体精度验证结果。

源代码：[SimpleStreamManager](../../vps-server/src/services/SimpleStreamManager.js) 的 `renameCompletedSegment()` / `renameFinalSegment()`，以及 [RecordingRecoveryService](../../vps-server/src/services/RecordingRecoveryService.js) 的 `renameTempFile()` / `getVideoDuration()` / `formatTime()`。

## 6. 处理时机与安全 MP4 封装

| 时机 | 实际调用与处理 |
| --- | --- |
| FFmpeg 打开新分段 | 按会话模板解析 stderr 的 `Opening` 信息；当段号增大，上一段进入该会话的 `segmentQueue` 串行封装，不再靠固定 2 秒延迟宣称关闭 |
| 正常停止或健康恢复 | 频道锁内标记 `stopping`，发送终止信号并等待本会话 `close`，再统一收尾；没有确认关闭就保留原文件并报错 |
| 非预期进程退出 | `exit` 只记录退出状态和时间；`close` 后排队取得频道锁，按会话身份执行一次收尾：分段处理本会话剩余段，单文件处理该会话的 `temp_000` |
| 恢复服务处理遗留 temp | 锁内复查候选和活跃文件归属后调用同一安全封装入口 |

`_finishStreamLocked()` 等待本会话已有的分段任务，然后只处理该会话模板匹配的剩余文件。共享状态、HLS 清理由会话身份保护，旧进程回调不能删除后继会话的状态或输出。健康恢复直接重建录制，不再经过“先停录、自动启动纯观看、再启动录制”的中间步骤。

分段与单文件收尾均由 `convertSegmentToStandardMp4()` 委托 [SegmentFinalizer](../../vps-server/src/services/recording/SegmentFinalizer.js) 执行：

1. 确认调用目标不属于当前仍在写入的分段；检查源文件非空、身份和大小稳定，并读取视频流及有效时长。
2. 在目标目录排他创建本次唯一 `.part.mp4` 文件，使用 `-c copy -movflags faststart` 重封装到该临时产物。
3. 检查输出视频流、有效时长及与输入时长的差异，并再次确认原文件未变化。
4. 通过硬链接排他发布正式文件；目标存在则失败，不覆盖已有录像。
5. 发布成功后再删除源临时文件；删除失败时保留原件。只有成功返回的处理才派发文件最终化事件。

转换失败、媒体校验失败、源文件变化或超时都拒绝此次处理并保留源临时文件；不再以直接改名降级成“成功”。清理只针对本次拥有的 part 或本次发布且身份仍匹配的文件。处理超时有终止、强杀和有界等待，不能只发送信号后继续假定成功。

部署前需要确认 FFmpeg 与 ffprobe 均可执行。安全封装可用 `FFPROBE_PATH` 显式指定探测工具；未设置时，若 FFmpeg 配置带目录则从同目录推导 `ffprobe`（Windows 对应 `ffprobe.exe`），否则经 PATH 查找。缺少探测工具会使封装校验失败并保留源文件。

本版本新录制的分段与单文件都在验证通过后才发布正式名，但它仍不能替代播放器验收。历史版本可能留下仍在写入或未经校验的正式形态文件，因此不能把目录中任意 `_to_` 或 `.mp4` 都视为已通过本次流程。最终化事件只表示进入上传调度流程，不证明云端已完成。

源代码：[SimpleStreamManager](../../vps-server/src/services/SimpleStreamManager.js) 的进程生命周期、分段队列和会话收尾方法，以及 [SegmentFinalizer](../../vps-server/src/services/recording/SegmentFinalizer.js)。

## 7. 启动恢复与手动恢复

两条入口的候选筛选逻辑不同，真正处理时共用频道锁和活跃文件保护：

| 项目 | 启动自动恢复 | 手动恢复 API |
| --- | --- | --- |
| 入口 | `startup()` → `runRecoveryWithSizeCheck()` | `runRecovery()` → `findFilesNeedingRecovery()` |
| 候选筛选 | 延迟 5 秒开始扫描；有 temp 时，再等待 30 秒比较大小 | API 调用后筛选，不等待这轮 30 秒大小观察 |
| temp 条件 | 两次大小相同；处理前继续检查候选快照 | 修改时间至少经过 30 秒，且该频道没有活跃录制；锁内再次复核 |
| 处理类型 | temp 文件 | temp，以及符合原有筛选条件的预设结束时间文件 |

两条入口通过单次运行门闩避免扫描交叠；服务忙或正在关闭时手动 API 返回 202 并说明跳过，不宣称恢复完成。`stop()` 取消尚未开始的启动任务及大小观察，等待已经开始的本轮处理结束。

每个候选在 `withChannelLock()` 内检查 `starting` / `stopping` 状态和 `isRecordingFileActive()`，复查文件身份、mtime、大小并短暂观察稳定性，再执行改名或安全封装。当前会话仍在写入的文件会跳过；同频道已关闭的历史文件可由自动路径处理。文件大小不变不等于写入进程已关闭。

启动入口从 `RECOVERY_SCAN_HOURS` 环境变量读取扫描窗口，默认 48 小时；不是直接读取前端保存的 `recoveryScanHours`。扫描仍限制为最近 3 个 `YYYYMMDD` 目录及 mtime 窗口。时间算法、恢复本地时区以及手动预设结束时间判断中的秒/毫秒不一致不属于本轮修改范围；不能把旧文档“相差 5 分钟才修复”作为可靠保证。

服务关停在第一个异步等待前通过 `beginShutdown()` 同步禁止新会话，再停止录制、预加载、健康检查及文件扫描入口，随后等待真实 `SimpleStreamManager.destroy()`，再关闭旧管理器与上传 Worker。重复退出信号共用一次关停；关闭错误会记录并以非零状态退出。PM2 `kill_timeout` 已调整为 180000 毫秒，生产部署还应将外层 systemd 的 `TimeoutStopSec` 配置为 300 秒，为有界关闭和文件处理留出时间；超过外部关停期限时，遗留 temp 仍需后续恢复。

一键部署脚本通过 systemd 以 `yoyo` 用户运行 PM2，并设置守护进程 `TZ=Asia/Shanghai`。本版每日维护重启为北京时间 `03:00`；该 cron 按 PM2 守护进程时区执行。部署前需确认只有一个实例管理本应用，不能同时保留 root 与 yoyo 两套自启动实例争抢端口和录像。

源代码：[app.js](../../vps-server/src/app.js)、[RecordingRecoveryService](../../vps-server/src/services/RecordingRecoveryService.js)、[PM2 配置](../../vps-server/ecosystem.config.js)。

## 8. 自动上传后的命名

VPS 上传 Worker 在上传调用成功返回后，对本地文件追加标记：

```text
..._074001_to_084001.mp4
→ ..._074001_to_084001_u.mp4
```

若目标名已存在，则使用 `..._u_<Date.now()>.mp4` 避免直接覆盖。此标记属于 VPS 上传流程，不改变录制时的分段规则，也不能用它替代其他独立转存程序的目的地核验。

源代码：[CloudUploadWorker](../../vps-server/src/services/upload-queue/CloudUploadWorker.js) 的上传处理及 `renameWithSuccessMark()`；流程说明见[录制文件自动上传开发实施文档](../录制文件自动上传开发实施文档.md)。

## 9. 生命周期修复与仍需验证的边界

本轮本地修复覆盖以下六条路径，验证目标是阻止启动、重启和收尾互相干扰：

| 路径 | 当前保护 |
| --- | --- |
| 启动尚未完成就被巡检误判 | spawn 前登记 `starting` 会话；健康巡检跳过启动/停止和频道锁内的过渡状态，恢复前再次核对配置代次与录制时间窗 |
| 观看取配置失败引发重启并丢失录制 | 配置未知时沿用现有滤镜；有效配置变更、手动重启、预加载换源，以及 `IntegratedStreamingService` 源切换均经同一频道锁内的原子操作保留录制意图 |
| 旧进程回调误删新会话 | 回调捕获具体会话，退出与关闭分离；清理共享 Map 和 HLS 前检查是否仍拥有该频道 |
| 复用旧播放列表而误判新进程就绪 | 启动前清理旧 HLS；进程必须仍存活，新播放列表和分片需在 spawn 后更新；录制还需本会话文件在连续观察中增长，或已有本会话经 ffprobe 校验并安全发布的闭合分段 |
| 健康恢复经过纯观看中间态 | `recoverRecording()` 锁内直接重建录制，并在异步等待前后核对是否仍应恢复 |
| 文件仍在写入时被封装 | 停止路径等待本会话 `close` 后才收尾；分段使用固定会话模板与串行封装，单文件也先写 temp；二者均在校验后安全发布，失败保留原始文件 |

关联防护还包括：同一时间源生成会话路径与分段名、跨午夜沿用会话目录、同秒会话避让、正式文件排他发布，以及恢复服务对活跃文件的锁内检查。

以下问题不能据本轮代码修复宣称已解决：

- 普通段名称仍按配置时长推算，未改为媒体时钟或逐段内容时间；未根治源流缺失、源时间戳异常或约 0.97× 处理速度造成的落后。
- 恢复格式化仍依赖进程本地时区，预设结束时间检查仍有单位问题；这些属于独立修复范围。
- 当前保护以同一 manager 的频道锁和会话身份为基础，多个独立服务进程、外部写入者或人工修改仍需单独协调。
- 有效视频流和时长校验不能证明每一帧完整或能在所有播放器正常播放；需要目标环境样本验证。
- 本地测试和合成样本不能代替真实源流、生产配置、跨网络故障及实际部署结果。

## 10. 文档关系与核验范围

- 本文替代初版中旧临时名、`renameSegmentFiles()` 草图、10～240 分钟范围、旧 KV 键及“停止后统一改名”等说明。
- [架构说明](ARCHITECTURE_V2.md)提供系统上下文；其中历史日志和部署记录不能代替当前环境证据。
- [阶段实施文档](RECORDING_SEGMENTATION_IMPLEMENTATION.md)与[完成报告](RECORDING_SEGMENTATION_COMPLETION_REPORT.md)保留历史工作记录，并标明现行规则入口。
- [最初录制方案](VIDEO_RECORDING_SOLUTION.md)中的 `YYYY-MM-DD_HH-MM_HH-MM.mp4` 属于历史方案，不作为当前文件解析规范。
- VPS 子项目新增 `npm run test:recording`，汇总生命周期、调度/路由、恢复/关停及安全封装测试。本地已完成真实 FFmpeg 的合成输入 HLS + MP4 双输出验证，覆盖短分段、低码率长分段及单文件；这不等于真实源流录制验收。本节仅记录本地验证，目标环境部署及云端上传验收以对应发布记录为准；旧报告中的通过项不视为本次重新验证。
- [恢复说明](RECORDING_RECOVERY_IMPLEMENTATION.md)和[恢复验证指南](RECORDING_RECOVERY_TEST.md)此前按未修复的 `66e5339` 整理，其中直接改名降级及无频道锁的流程已由本文第 6、7 节覆盖。阅读这些文档时应保留其基线边界。
