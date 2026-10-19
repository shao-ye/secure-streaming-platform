# 录制文件恢复实现说明

**更新日期**：2026-10-19

**代码基线**：`66e5339`

**核验范围**：当前仓库的静态代码；本次未执行部署、异常注入或目标环境验收。

录制分段、临时名及正常分段命名的统一说明见 [录制分段与命名规则](./RECORDING_SEGMENTATION_DESIGN.md)。本文只说明服务启动或手动触发后的遗留文件恢复，不能将这里的时间算法套用于正常分段。

## 1. 当前实现入口

| 职责 | 当前代码 |
| --- | --- |
| 加载服务、启动后初始化、手动恢复 API | [app.js](../../vps-server/src/app.js) |
| 文件扫描、恢复筛选、恢复命名 | [RecordingRecoveryService.js](../../vps-server/src/services/RecordingRecoveryService.js) |
| Fragmented MP4 录制参数、标准 MP4 重封装及降级 | [SimpleStreamManager.js](../../vps-server/src/services/SimpleStreamManager.js) |

`app.js` 在模块加载成功且 `streamManager` 存在时创建恢复服务，随后调用 `startup()`。构造器当前将 `enabled` 设为 `true`；是否在目标环境实际执行，仍需启动日志确认。

两条入口使用不同的筛选方式：

| 项目 | 启动自动恢复 | 手动恢复 |
| --- | --- | --- |
| 入口 | `startup()` → `runRecoveryWithSizeCheck()` | `POST /api/admin/recovery/execute` → `runRecovery()`，校验 `x-api-key` |
| 开始时机 | `startup()` 调度后延迟 5 秒 | API 调用时开始，不执行 30 秒大小观察 |
| 扫描方法 | `findTempFiles()`，只找临时 MP4 | `findFilesNeedingRecovery()`，检查临时 MP4，也可能检查预设结束时间的正式 MP4 |
| 临时文件筛选 | 记录初始大小，等待 30 秒，前后大小完全相同才进入恢复 | mtime 距当前至少 30 秒，且频道没有活跃录制进程 |
| 正在录制判断 | 按本次观察期间的文件大小变化判断 | 按文件修改时间和频道 `activeStreams.isRecording` 判断 |

自动恢复不是“文件超过 1 小时才处理”，也不是服务启动 5 秒后已经恢复完成。存在候选文件时，仅调度和大小观察就需要约 35 秒，之后还有探测、逐文件转换等时间；无候选文件时可提前结束。固定等待 10 秒或 15 秒不能作为完成条件。

当前自动恢复只有这次启动调度，不是持续轮询。大小有变化的文件会在本次扫描中跳过；30 秒大小不变也只是当前实现采用的判断条件，不能独立证明文件未被占用。

## 2. 扫描配置与目录范围

`app.js` 实际传入的配置为：

```javascript
const systemConfig = {
  recoveryScanHours: parseInt(process.env.RECOVERY_SCAN_HOURS) || 48
};
```

因此，当前启动路径从 `RECOVERY_SCAN_HOURS` 环境变量读取扫描小时数，缺省为 48。旧方案中“从前端系统设置接口读取 `recoveryScanHours`”的草图不代表当前启动代码。构造器注释提到的 12–168 小时范围，也不是这条启动路径已实现的数值校验。

两条扫描路径都受以下条件限制：

1. 优先使用 `streamManager.recordingConfigs` 中的频道和各频道 `storagePath`。仅当该集合为空时，才从录制根目录枚举名称以 `stream_` 开头的目录。
2. 频道未提供 `storagePath` 时，使用 `RECORDINGS_PATH`；当前代码兜底值为 `/srv/filebrowser/yoyo-k`。该路径是代码默认值，不是对目标环境路径的确认。
3. 每个频道只扫描名称为 8 位数字、按名称排序后的最近 3 个日期目录。
4. 文件必须以 `.mp4` 结尾，且 `mtime > 当前时间 - scanRecentHours × 60 × 60 × 1000`（毫秒）。判断依据是修改时间，不是创建时间，也不是仅依据文件名日期。
5. 自动恢复进一步要求文件名包含 `_temp_`；手动路径还可能检查正式文件。

扩大 `RECOVERY_SCAN_HOURS` 不会取消“最近 3 个日期目录”的限制。目录兜底扫描得到的频道没有 `recordConfig`，会跳过正式文件的预设结束时间检查。

## 3. 临时文件恢复命名

### 3.1 可识别格式

```text
新格式：{频道名}_{频道ID}_{YYYYMMDD}_{本次录制开始HHMMSS}_temp_XXX.mp4
旧格式：{频道名}_{频道ID}_{YYYYMMDD}_temp_XXX.mp4
正式名：{频道名}_{频道ID}_{YYYYMMDD}_{计算开始HHMMSS}_to_{计算结束HHMMSS}.mp4
```

`renameTempFile()` 同时兼容这两代临时名；当前匹配正则要求段号恰好为 3 位。仅包含 `_temp_` 但不符合完整格式的文件会被扫描到，随后因无法解析而跳过。

新格式中的开始时间用于区分录制会话，避免旧格式同日重复录制容易出现的重名问题。它不等于该会话后续每一段的实际开始时间；恢复过程也不会直接把它作为正式文件的开始时间。临时名生成和正常分段的段号含义以主规范为准。

### 3.2 恢复时间算法

新旧格式都使用以下算法：

```text
视频时长（秒） = ffprobe 读取 format=duration
结束时间       = 原临时文件 mtime
开始时间       = 结束时间 - 视频时长
正式名日期     = 原临时文件名中的 YYYYMMDD
```

对应方法为 `renameTempFile()`、`getVideoDuration()` 和 `formatTime()`。新格式还会将计算开始时间与临时名中的会话开始时间比较，差异超过 60 秒时记录 `Start time mismatch detected`，但仍使用计算值生成正式名。段号不参与这条恢复时间计算。

恢复得到的是基于 mtime 和媒体时长的推算值。复制文件、人工修改 mtime、媒体时长解析异常都会影响结果；不能把它直接当作独立校验过的拍摄时间。跨日恢复时，代码继续沿用原文件名日期，不会按反推开始日期重新选择目录。

### 3.3 时区与冲突处理

`formatTime()` 当前使用 `Date.getHours()`、`getMinutes()`、`getSeconds()`，依赖 Node 进程所在环境的本地时区；解析临时名时间用于比较时，也使用本地 `Date` 构造器。此恢复路径没有显式转换为北京时间。需要北京时间结果时，应核对目标进程时区和样本输出，不能只因正常录制命名采用北京时间就认定恢复输出也一定一致。

如果目标正式文件已经存在，恢复代码记录 `Target file already exists` 并跳过，不覆盖该正式文件，也不清除原临时文件。这种跳过不能计为已经成功恢复。

## 4. 标准 MP4 重封装与降级

识别为可恢复临时文件、时间探测成功且目标名不存在后，新旧格式都调用 `streamManager.convertSegmentToStandardMp4()`，这是常规步骤，不是仅在预先检测到文件损坏时才执行的备用逻辑。

该方法实际启动的核心参数为：

```text
ffmpeg -i <临时文件> -c copy -movflags faststart -y <正式文件>
```

`-c copy` 表示重封装而非重新编码。正常成功分支要求 FFmpeg 退出码为 0 且输出文件存在，然后删除临时文件。转换失败、进程错误或 60 秒超时分支会尝试直接改名降级；各分支还受输入、输出文件是否存在的条件影响。生成正式名不等于标准 MP4 转换成功，也不等于播放完整性已经验证。

`runRecoveryWithSizeCheck()` 和 `runRecovery()` 内仍有“只重命名、不修复格式”的旧注释，但实际调用链是：

```text
fixFileName(temp)
  → renameTempFile()
  → convertSegmentToStandardMp4()
```

判断当前行为应以这条调用链为准。`checkFilePlayable()`、`repairFileFormat()` 虽仍在服务文件中，当前这两条恢复主流程没有按旧草图先调用它们。

恢复生成正式文件后会尝试派发文件最终化事件；`app.js` 注入了调度器时，该事件可进入后续自动上传流程。恢复完成不表示云盘上传或云端核对完成。

## 5. 正式文件的预设结束时间纠正

这一分支仅属于手动 `runRecovery()` 路径，启动自动恢复只扫描临时文件。

当频道有录制配置时，手动扫描会匹配正式名末尾的 `_HHMMSS_to_HHMMSS.mp4`。结束时间等于频道预设 `endTime`，并且 `needsEndTimeCheck()` 判定需要处理时，才生成 `wrongEndTime` 候选；`fixEndTime()` 随后用文件 mtime 替换正式名结束时间，目标已存在时不改名。

**已知代码边界**：`parseTimeString()` 返回秒数，但 `needsEndTimeCheck()` 又将两个时间的差除以 1000，再与 ffprobe 的秒数比较。因此旧文档“实际时长与预期相差超过 5 分钟才修复”不能作为当前可靠保证。该计算还未处理跨午夜的时间差。本次仅修订文档，没有修复这些代码问题。

## 6. 核验与验收

当前源代码可证明存在上述入口与计算路径，不能证明目标环境使用同一版本、目录配置正确或样本已经恢复。运行验收按 [恢复测试指南](./RECORDING_RECOVERY_TEST.md) 执行，并记录具体输入文件、mtime、媒体时长、目标文件和日志。

不能仅凭 HTTP 成功返回、`Recovery completed` 汇总或“正式文件存在”判定成功：单个恢复函数会自行捕获异常，转换方法也有降级分支，需要核对本次具体文件。

## 7. 历史方案说明

本文原版为 2025-10-30 的 v1.0 实施计划，其进度表各阶段均为“未开始”，没有可据此认定当前环境已部署或验收通过的结果。原“部署完成”“可靠性 99.9%”“最大丢失约 2 秒”“零性能影响”等结尾声明，没有在本次静态核验中取得运行证据，不能作为当前保证。

本次将原实施草图和“完整代码”附录替换为实际方法入口及行为说明，避免直接复制后覆盖现有实现。以下旧内容仅作为历史设计背景，不再作为现行操作步骤：

- `vps-transcoder-api/vps-transcoder-api/` 等旧源码路径，以及围绕旧目录的部署、提交命令。
- 通过前端配置接口初始化恢复服务、修改时间超过 1 小时才恢复，以及启动 5 秒后即完成的早期设想。
- 先检测不可播放再备用修复格式的示例主循环。
- 固定等待 10 秒或 15 秒即断言恢复完成的测试步骤。

2025-10-31 的“仅改名后文件只能播放约 4 秒”历史问题记录保留在 [恢复测试指南](./RECORDING_RECOVERY_TEST.md) 中；该记录不替代当前版本验收。

## 8. 相关文档

- [录制分段与命名规则](./RECORDING_SEGMENTATION_DESIGN.md)：当前统一规范，区分正常分段与异常恢复。
- [录制文件恢复测试指南](./RECORDING_RECOVERY_TEST.md)：当前待执行用例及证据要求。
- [系统架构文档](./ARCHITECTURE_V2.md)：架构及历史演进背景。
