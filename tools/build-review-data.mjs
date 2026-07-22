// DreamHome · 149 真实资产评审看板的数据烘焙（一次性 dev 工具，产物提交入库）
//
// 读 datasets/available-assets-v1（manifest + 各 asset.json 全字段）→
// 每条附派生本地素材 URL（根绝对，指向已烘焙的 /prototype/assets/{models,renders,frames,videos}）→
// 写 web/review/review-data.generated.json，供 web/review/index.html 评审看板 fetch。
//
// 运行：node tools/build-review-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATASET = join(ROOT, 'datasets', 'available-assets-v1');
const OUT_DIR = join(ROOT, 'web', 'review');
const OUT = join(OUT_DIR, 'review-data.generated.json');

const manifest = JSON.parse(readFileSync(join(DATASET, 'manifest.json'), 'utf8'));
mkdirSync(OUT_DIR, { recursive: true });

const assets = manifest.assets.map((entry) => {
  const rec = JSON.parse(readFileSync(join(DATASET, entry.record), 'utf8'));
  const id = rec.asset_id;
  const vid = rec.video_id || '';
  // 派生素材 URL（根绝对，http.server 以 web/ 为根）；均为已烘焙压缩产物
  return {
    ...rec,
    urls: {
      model: `/prototype/assets/models/${id}.glb`,
      render: `/prototype/assets/renders/${id}.png`,
      frame: `/prototype/assets/frames/${id}.jpg`,
      video: vid ? `/prototype/assets/videos/${vid}.mp4` : null,
    },
  };
});

const payload = {
  generated_at: manifest.generated_at || null,
  count: assets.length,
  assets,
};
writeFileSync(OUT, JSON.stringify(payload), 'utf8');

const byCat = {};
for (const a of assets) byCat[a.type.category] = (byCat[a.type.category] || 0) + 1;
console.log(`assets: ${assets.length}`);
console.log('categories:', Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(' '));
console.log(`size: ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`);
console.log(`wrote: ${OUT}`);
