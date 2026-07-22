// DreamHome · 从压缩 GLB 离线渲染 2D 缩略图（一次性 dev 工具，产物提交入库）
//
// 目的：家具卡缩略图与弹窗详情页的 3D 组件「严格一致」——用与 open3DViewer 相同的相机/灯光，
// 把每个 GLB 渲染成透明背景 PNG，替换掉之前良莠不齐的照片/视频截图缩略图。
//
// 依赖：puppeteer-core（devDependency，驱动本机 Chrome）+ 本地 http.server:5180 已在跑 + 先跑过 build-library.mjs（models 已生成）。
// 运行：node tools/render-thumbnails.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RENDER_OUT = join(ROOT, 'web', 'prototype', 'assets', 'renders');
const JS_OUT = join(ROOT, 'web', 'prototype', 'pages', 'shared', 'library-assets.generated.js');
const RENDER_URL_PREFIX = '../../assets/renders/';
const BASE = 'http://127.0.0.1:5180';
const HARNESS = `${BASE}/prototype/_render_harness.html`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 读生成的资产表（拿 id + model_url）
const mod = await import(JS_OUT);
const assets = mod.BACKEND_ASSETS.filter((a) => a.model_url);
console.log(`待渲染 models: ${assets.length}`);

rmSync(RENDER_OUT, { recursive: true, force: true });
mkdirSync(RENDER_OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.goto(HARNESS, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const rendered = new Set();
let ok = 0, fail = 0;
for (const a of assets) {
  const id = a.asset_id;
  const glbUrl = `${BASE}/prototype/assets/models/${id}.glb`;
  try {
    const res = await page.evaluate((u) => window.renderGLB(u), glbUrl);
    if (res !== true) throw new Error(String(res));
    const canvas = await page.$('#c');
    await canvas.screenshot({ path: join(RENDER_OUT, `${id}.png`), omitBackground: true, type: 'png' });
    rendered.add(id); ok += 1;
  } catch (e) {
    fail += 1; console.log(`\n  ✗ ${id}: ${e.message}`);
  }
  process.stdout.write(`\r  渲染 ${ok + fail}/${assets.length}  ok=${ok} fail=${fail}   `);
}
process.stdout.write('\n');
await browser.close();

// 收尾：把渲染成功的资产 thumbnail 指向 render PNG（失败的保留原照片 jpg，避免 404）
const text = readFileSync(JS_OUT, 'utf8');
const banner = text.slice(0, text.indexOf('export const BACKEND_ASSETS'));
const data = mod.BACKEND_ASSETS.map((a) => rendered.has(a.asset_id)
  ? { ...a, thumbnail: `${RENDER_URL_PREFIX}${a.asset_id}.png` }
  : a);
writeFileSync(JS_OUT, `${banner}export const BACKEND_ASSETS = ${JSON.stringify(data, null, 0)};\n`, 'utf8');

console.log(`渲染完成：ok ${ok}, fail ${fail} → assets/renders/`);
console.log(`已把 ${rendered.size} 个 thumbnail 指向渲染 PNG；失败的保留照片兜底。`);
console.log(`回写：${JS_OUT}`);
