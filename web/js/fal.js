// fal.ai 队列 API 浏览器直连客户端
// 所有 fetch 必须带超时 + 重试（AbortController），否则弱网下卡死的请求会占满
// Chrome 每主机 6 条连接池，全局假死。
import { FAL, getKey } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function timeoutFetch(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
}

// 带重试：4xx 校验错误不重试（无意义），网络/超时/5xx 才退避重试
async function withRetry(fn, times, delays) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(i); }
    catch (e) {
      last = e;
      if (e && e.nonRetriable) throw e;
      if (i < times - 1) await sleep(delays[Math.min(i, delays.length - 1)]);
    }
  }
  throw last;
}

async function readErr(res) {
  let detail = '';
  try { const j = await res.json(); detail = j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : (j.message || ''); }
  catch (e) { try { detail = await res.text(); } catch (_) {} }
  const err = new Error(`fal ${res.status}${detail ? '：' + detail.slice(0, 160) : ''}`);
  if (res.status >= 400 && res.status < 500 && res.status !== 429) err.nonRetriable = true;
  return err;
}

const authHeaders = (key, json) => json
  ? { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' }
  : { 'Authorization': `Key ${key}` };

// 提交：20s 超时 × 3
async function submit(endpoint, body, key) {
  const res = await withRetry(() => timeoutFetch(
    `${FAL.base}/${endpoint}`,
    { method: 'POST', headers: authHeaders(key, true), body: JSON.stringify(body) },
    20000
  ), 3, [2000, 4000]);
  if (!res.ok) throw await readErr(res);
  return res.json(); // { request_id, status_url, response_url, ... }
}

// 轮询状态：单次 10s 超时 × 4，循环直到 COMPLETED，总时长封顶
async function pollUntilDone(statusUrl, key, { overallMs = 180000, onStatus } = {}) {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > overallMs) throw new Error('生成超时，请重试');
    const res = await withRetry(() => timeoutFetch(statusUrl, { headers: authHeaders(key) }, 10000), 4, [1000, 2000, 4000]);
    if (!res.ok) throw await readErr(res);
    const data = await res.json().catch(() => ({}));
    const status = (data.status || '').toUpperCase();
    if (onStatus) onStatus(data);
    if (status === 'COMPLETED') return data;
    if (status === 'FAILED' || status === 'ERROR') throw new Error('生成失败，请重试');
    await sleep(1200);
  }
}

async function getResult(responseUrl, key) {
  const res = await withRetry(() => timeoutFetch(responseUrl, { headers: authHeaders(key) }, 20000), 3, [2000, 4000]);
  if (!res.ok) throw await readErr(res);
  return res.json();
}

// 端到端：提交 → 轮询 → 取结果
export async function run(endpoint, body, opts = {}) {
  const key = opts.key || getKey();
  if (!key) { const e = new Error('缺少 fal key'); e.noKey = true; throw e; }
  const q = await submit(endpoint, body, key);
  if (opts.onQueue) opts.onQueue(q);
  if (q.status_url) {
    await pollUntilDone(q.status_url, key, opts);
    return getResult(q.response_url || q.status_url.replace(/\/status$/, ''), key);
  }
  return q; // 少数同步返回
}

// 从结果里找 GLB/网格 URL（对齐 bench/fal_bench.py 的 find_mesh_url）
export function findMeshUrl(res) {
  if (!res || typeof res !== 'object') return null;
  for (const k of ['model_mesh', 'mesh', 'model', 'glb', 'model_glb']) {
    const v = res[k];
    if (v && typeof v === 'object' && v.url) return v.url;
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  for (const v of Object.values(res)) {
    if (v && typeof v === 'object' && typeof v.url === 'string') {
      const u = v.url.split('?')[0].toLowerCase();
      if (/\.(glb|obj|ply|zip|gltf)$/.test(u)) return v.url;
    }
  }
  return null;
}

// 从结果里找图片 URL（flux 系列：images[0].url / image.url）
export function findImageUrl(res) {
  if (!res || typeof res !== 'object') return null;
  if (Array.isArray(res.images) && res.images[0]) return res.images[0].url || res.images[0];
  if (res.image && (res.image.url || typeof res.image === 'string')) return res.image.url || res.image;
  for (const v of Object.values(res)) {
    if (v && typeof v === 'object' && typeof v.url === 'string' && /\.(png|jpg|jpeg|webp)/.test(v.url.split('?')[0].toLowerCase())) return v.url;
  }
  return null;
}

// 启动时静默预热 TRELLIS：先发一张小图把热端点唤醒，吃掉现场第一发的冷启动。
// 冷启动约 54s；预热同时也是连通性检查。fire-and-forget，吞掉所有错误。
export function prewarm() {
  if (!getKey()) return;
  // 64×64 中性小图，payload 极小、且能真实触发一次推理来热 GPU
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#b7a98e'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#7d6f57'; g.fillRect(16, 20, 32, 28);
  const uri = c.toDataURL('image/jpeg', 0.7);
  run(FAL.trellis, { image_url: uri }, { overallMs: 90000 }).catch(() => {});
}
