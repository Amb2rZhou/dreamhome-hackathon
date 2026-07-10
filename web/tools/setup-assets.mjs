#!/usr/bin/env node
// 一次性物料脚本：把前端依赖自托管到 web/vendor/，并生成 PWA 图标到 web/icons/。
// 纯静态站点不需要构建，但第三方库与图标是二进制/大文件，不入 git；部署前跑一次：
//   node web/tools/setup-assets.mjs
// 依赖：Node 18+（用到内置 zlib/child_process）。会临时 `npm pack` 两个包。
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const VENDOR = join(WEB, 'vendor');
const ICONS = join(WEB, 'icons');
mkdirSync(VENDOR, { recursive: true });
mkdirSync(ICONS, { recursive: true });

// ── 1) vendor 第三方库 ─────────────────────────────────────
function pack(pkg, tmp) {
  execSync(`npm pack ${pkg}`, { cwd: tmp, stdio: 'inherit' });
  execSync(`tar xzf *.tgz`, { cwd: tmp, shell: '/bin/bash' });
  return join(tmp, 'package');
}

const tmp = mkdtempSync(join(tmpdir(), 'dh-vendor-'));
try {
  // model-viewer 固定 3.5.0（坑3：latest 是坏的调试版）
  const mv = pack('@google/model-viewer@3.5.0', mkdtempSync(join(tmp, 'mv-')));
  copyFileSync(join(mv, 'dist/model-viewer.min.js'), join(VENDOR, 'model-viewer-3.5.0.min.js'));

  // three 0.160
  const three = pack('three@0.160.0', mkdtempSync(join(tmp, 'three-')));
  copyFileSync(join(three, 'build/three.module.js'), join(VENDOR, 'three.module.js'));
  copyFileSync(join(three, 'examples/jsm/controls/OrbitControls.js'), join(VENDOR, 'OrbitControls.js'));
  copyFileSync(join(three, 'examples/jsm/utils/BufferGeometryUtils.js'), join(VENDOR, 'BufferGeometryUtils.js'));
  // 坑2：GLTFLoader 引用 '../utils/BufferGeometryUtils.js'，改为同目录
  let gltf = readFileSync(join(three, 'examples/jsm/loaders/GLTFLoader.js'), 'utf8');
  gltf = gltf.replace(/'\.\.\/utils\/BufferGeometryUtils\.js'/g, "'./BufferGeometryUtils.js'");
  writeFileSync(join(VENDOR, 'GLTFLoader.js'), gltf);
  console.log('✓ vendor 就绪：model-viewer@3.5.0 + three@0.160');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 2) 生成 PWA 图标（house 字形，暖色系）────────────────────
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
const hex = (h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const paper = hex('f2efe9'), terra = hex('b05e33');
function icon(size, path, maskable) {
  const S = size, buf = Buffer.alloc(S * (S * 4 + 1));
  const inset = maskable ? S * 0.12 : 0;
  for (let y = 0; y < S; y++) {
    buf[y * (S * 4 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      let c = terra;
      const nx = (x - inset) / (S - 2 * inset), ny = (y - inset) / (S - 2 * inset);
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
        const roofY = 0.16, baseY = 0.46; let inHouse = false;
        if (ny >= roofY && ny <= baseY) { const t = (ny - roofY) / (baseY - roofY); const hw = 0.36 * t; if (nx >= 0.5 - hw && nx <= 0.5 + hw) inHouse = true; }
        if (ny >= baseY && ny <= 0.82 && nx >= 0.22 && nx <= 0.78) inHouse = true;
        if (inHouse) c = paper;
        if (ny >= 0.60 && ny <= 0.82 && nx >= 0.44 && nx <= 0.56) c = terra;
      }
      const o = y * (S * 4 + 1) + 1 + x * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(buf, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(path, png);
}
icon(192, join(ICONS, 'icon-192.png'), false);
icon(512, join(ICONS, 'icon-512.png'), false);
icon(512, join(ICONS, 'maskable-512.png'), true);
icon(180, join(ICONS, 'apple-touch-icon.png'), false);
console.log('✓ 图标就绪：icon-192 / icon-512 / maskable-512 / apple-touch-icon');
console.log('全部完成。现在可直接把 web/ 作为静态目录部署。');
