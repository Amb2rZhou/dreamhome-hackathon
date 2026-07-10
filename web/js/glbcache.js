// 坑4：GLB 加载走 Cache API（缓存名 dh-glb-v1）。先查缓存，没有则 fetch（带 25s 超时）
// 存入，返回 objectURL；失败退回原 URL。弱网救命。
import { GLB_CACHE } from './config.js';

export async function cachedGlbUrl(url) {
  if (!url || !window.caches) return url;
  try {
    const cache = await caches.open(GLB_CACHE);
    let res = await cache.match(url);
    if (!res) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 25000);
      const net = await fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
      if (!net.ok) throw new Error('fetch glb ' + net.status);
      await cache.put(url, net.clone());
      res = net;
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (e) {
    return url; // 退回原 URL，交给 model-viewer/loader 直连
  }
}
