// DreamHome · 灵感库真实资产烘焙脚本（一次性 dev 工具，产物提交入库）
//
// 读 datasets/available-assets-v1 →
//   · 缩略图     completed_input.jpg(缺则 source_crop.jpg) → web/prototype/assets/library/<id>.jpg
//   · 源视频帧   context.jpg                              → web/prototype/assets/frames/<id>.jpg（视频海报）
//   · 压缩 3D    model.glb（贴图 WebP+缩放、几何 Draco）  → web/prototype/assets/models/<id>.glb
//   · 压缩视频   videos/<vid>/source.mp4（8 条共享，ffmpeg）→ web/prototype/assets/videos/<vid>.mp4
// → 生成 web/prototype/pages/shared/library-assets.generated.js（export BACKEND_ASSETS）。
//
// 只保留前端需要的「后端原形字段」，适配逻辑放在 asset-library-data.js。
// 依赖：sips（macOS 自带）、ffmpeg、gltf-transform（`npm i -g @gltf-transform/cli`，缺失时回退 npx）。
// 运行：node tools/build-library.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// 缩略图 / 帧规格
const THUMB_MAX = 512, THUMB_QUALITY = 72;
const FRAME_MAX = 640, FRAME_QUALITY = 74;
// GLB 贴图目标边长（源贴图约 1024²，弹窗内 ~260px，1024 足够清晰；总量偏大时脚本会提示降到 768/512）
const TEXTURE_SIZE = 1024;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATASET = join(ROOT, 'datasets', 'available-assets-v1');
const THUMB_OUT = join(ROOT, 'web', 'prototype', 'assets', 'library');
const FRAME_OUT = join(ROOT, 'web', 'prototype', 'assets', 'frames');
const MODEL_OUT = join(ROOT, 'web', 'prototype', 'assets', 'models');
const VIDEO_OUT = join(ROOT, 'web', 'prototype', 'assets', 'videos');
const JS_OUT = join(ROOT, 'web', 'prototype', 'pages', 'shared', 'library-assets.generated.js');
// 页面在 web/prototype/pages/<page>/，素材在 web/prototype/assets/ → 相对路径 ../../assets/<kind>/<id>.<ext>
const THUMB_URL_PREFIX = '../../assets/library/';
const FRAME_URL_PREFIX = '../../assets/frames/';
const MODEL_URL_PREFIX = '../../assets/models/';
const VIDEO_URL_PREFIX = '../../assets/videos/';

// —— 工具函数 ——
const sipsResize = (src, dest, max, q) =>
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), '-Z', String(max), src, '--out', dest], { stdio: 'ignore' });

// gltf-transform：优先全局二进制，回退 npx（首个调用会自动下载）
let GLTF_MODE = null; // 'bin' | 'npx'
function optimizeGlb(src, dest) {
  const args = ['optimize', src, dest, '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', String(TEXTURE_SIZE), '--simplify', 'false'];
  const tries = GLTF_MODE === 'npx'
    ? [['npx', ['--yes', '@gltf-transform/cli', ...args]]]
    : [['gltf-transform', args], ['npx', ['--yes', '@gltf-transform/cli', ...args]]];
  for (const [cmd, a] of tries) {
    try { execFileSync(cmd, a, { stdio: 'ignore' }); GLTF_MODE = cmd === 'npx' ? 'npx' : 'bin'; return true; }
    catch { /* 试下一个 */ }
  }
  return false;
}

// 视频压缩：按 video_id 去重（149 件仅 8 条视频），H.264/720p/faststart 便于 web seek
const videoCache = new Map(); // video_id -> url|null
function ensureVideo(videoId) {
  if (!videoId) return null;
  if (videoCache.has(videoId)) return videoCache.get(videoId);
  const src = join(DATASET, 'videos', videoId, 'source.mp4');
  let url = null;
  if (existsSync(src)) {
    const dest = join(VIDEO_OUT, `${videoId}.mp4`);
    try {
      execFileSync('ffmpeg', ['-y', '-i', src, '-vf', "scale=-2:'min(720,ih)'",
        '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dest], { stdio: 'ignore' });
      url = `${VIDEO_URL_PREFIX}${videoId}.mp4`;
    } catch { url = null; }
  }
  videoCache.set(videoId, url);
  return url;
}

const duMB = (dir) => {
  try { return Math.round(parseInt(execFileSync('du', ['-sk', dir]).toString().split('\t')[0], 10) / 1024); }
  catch { return 0; }
};

// —— 主流程 ——
const manifest = JSON.parse(readFileSync(join(DATASET, 'manifest.json'), 'utf8'));
for (const d of [THUMB_OUT, FRAME_OUT, MODEL_OUT, VIDEO_OUT]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }

const records = [];
let thumbs = 0, thumbFallback = 0, frames = 0, models = 0, modelFail = 0;
const total = manifest.assets.length;

for (const entry of manifest.assets) {
  const id = entry.asset_id;
  const rec = JSON.parse(readFileSync(join(DATASET, entry.record), 'utf8'));
  const dir = join(DATASET, 'assets', id);

  // 缩略图：优先抠好的单品图，缺失回退 source_crop.jpg（149 件都有）
  const completed = join(dir, 'completed_input.jpg');
  const crop = join(dir, 'source_crop.jpg');
  const thumbSrc = existsSync(completed) ? completed : (existsSync(crop) ? crop : null);
  let thumbnail = null;
  if (thumbSrc) {
    if (thumbSrc === crop) thumbFallback += 1;
    sipsResize(thumbSrc, join(THUMB_OUT, `${id}.jpg`), THUMB_MAX, THUMB_QUALITY);
    thumbnail = `${THUMB_URL_PREFIX}${id}.jpg`; thumbs += 1;
  }

  // 源视频帧（context.jpg，含识别框）→ 视频海报
  const ctx = join(dir, 'context.jpg');
  let frameUrl = null;
  if (existsSync(ctx)) { sipsResize(ctx, join(FRAME_OUT, `${id}.jpg`), FRAME_MAX, FRAME_QUALITY); frameUrl = `${FRAME_URL_PREFIX}${id}.jpg`; frames += 1; }

  // 压缩 GLB
  const glb = join(dir, 'model.glb');
  let modelUrl = null;
  if (existsSync(glb)) { if (optimizeGlb(glb, join(MODEL_OUT, `${id}.glb`))) { modelUrl = `${MODEL_URL_PREFIX}${id}.glb`; models += 1; } else modelFail += 1; }

  // 压缩视频（去重）+ 代表帧时间戳
  const videoUrl = ensureVideo(rec.video_id);
  const repSec = rec.appearances?.[0]?.representative_sec ?? null;

  records.push({
    asset_id: id,
    name: rec.name,
    type: { category: rec.type.category, subcategory: rec.type.subcategory },
    labels: {
      colors: rec.labels?.colors ?? [],
      materials: rec.labels?.materials ?? [],
      styles: rec.labels?.styles ?? [],
    },
    size_status: rec.size_status,
    physical_size_m: rec.physical_size_m ?? { width: null, height: null, depth: null },
    dimensions_model_unit: rec.geometry?.dimensions_model_unit ?? null,
    thumbnail,
    frame_url: frameUrl,
    model_url: modelUrl,
    video_url: videoUrl,
    video_id: rec.video_id ?? '',
    representative_sec: repSec,
  });
  process.stdout.write(`\r  处理 ${records.length}/${total}  models=${models}(fail ${modelFail}) videos=${videoCache.size}   `);
}
process.stdout.write('\n');

const banner =
  `// AUTO-GENERATED by tools/build-library.mjs — 请勿手改。\n` +
  `// 源：datasets/available-assets-v1（${manifest.asset_count} 件，generated_at=${manifest.generated_at}）\n` +
  `// 字段保持后端 API 原形；前端适配见 asset-library-data.js 的 adaptBackendAsset()。\n`;
writeFileSync(JS_OUT, `${banner}export const BACKEND_ASSETS = ${JSON.stringify(records, null, 0)};\n`, 'utf8');

// 汇总
const byCat = {};
for (const r of records) byCat[r.type.category] = (byCat[r.type.category] || 0) + 1;
const okVideos = [...videoCache.values()].filter(Boolean).length;
console.log(`records: ${records.length}`);
console.log(`thumbs: ${thumbs} (fallback source_crop: ${thumbFallback}), frames: ${frames}`);
console.log(`models: ${models} ok, ${modelFail} fail  ·  videos: ${okVideos}/${videoCache.size}`);
console.log(`size → models: ${duMB(MODEL_OUT)} MB, videos: ${duMB(VIDEO_OUT)} MB, frames: ${duMB(FRAME_OUT)} MB, thumbs: ${duMB(THUMB_OUT)} MB`);
console.log('categories:', Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' '));
console.log(`wrote: ${JS_OUT}`);
if (duMB(MODEL_OUT) > 60) console.log('⚠ models 体积偏大：可把 TEXTURE_SIZE 降到 768/512 重跑。');
