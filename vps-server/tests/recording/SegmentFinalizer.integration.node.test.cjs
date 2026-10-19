const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const SegmentFinalizer = require('../../src/services/recording/SegmentFinalizer');

const ffmpegPath = process.env.TEST_FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.TEST_FFPROBE_PATH || 'ffprobe';
const toolsAvailable = [ffmpegPath, ffprobePath].every(command =>
  spawnSync(command, ['-version'], { windowsHide: true, timeout: 5000 }).status === 0);

test('真实工具：合成fragmented MP4安全转为时长一致的faststart文件', {
  skip: toolsAvailable ? false : 'Local FFmpeg/ffprobe unavailable',
  timeout: 30000
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-finalizer-real-'));
  const input = path.join(directory, 'synthetic_temp_000.mp4');
  const output = path.join(directory, 'synthetic_to_000002.mp4');
  try {
    // 仅生成独立临时目录内的两秒测试图，不访问源流或已有录像。
    const generated = spawnSync(ffmpegPath, [
      '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10',
      '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-an', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-y', input
    ], { windowsHide: true, timeout: 10000 });
    assert.equal(generated.status, 0, 'Synthetic video generation must succeed');
    const result = await new SegmentFinalizer({ ffmpegPath, ffprobePath, stableCheckMs: 20 })
      .finalize(input, output);
    assert.ok(Math.abs(result.durationSeconds - 2) < 0.1);
    assert.equal(result.sourceRetained, false);
    assert.equal(fs.existsSync(input), false);
    const data = fs.readFileSync(output);
    const moov = data.indexOf(Buffer.from('moov'));
    const mdat = data.indexOf(Buffer.from('mdat'));
    assert.ok(moov > 0 && mdat > moov, 'Faststart metadata must precede media data');
    assert.equal(data.indexOf(Buffer.from('moof')), -1);
    assert.deepEqual(fs.readdirSync(directory), [path.basename(output)]);
  } finally {
    // 校验绝对位置和专属前缀后，只清理由本测试生成的目录。
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('recording-finalizer-real-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
