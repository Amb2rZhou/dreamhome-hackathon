// 组件库：localStorage 持久化 { id, name, kind, glb, img(缩略图 dataURI), createdAt }
// glb 存远端 URL 或同源 assets 路径（objectURL 不能跨刷新持久化）。
import { STORE } from './config.js';

function read() {
  try { return JSON.parse(localStorage.getItem(STORE.library) || '[]'); }
  catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(STORE.library, JSON.stringify(list)); }
  catch (e) { /* 配额满：缩略图已压过，通常不会触发 */ }
}

let seq = 0;
function id() {
  seq += 1;
  return 'c' + Date.now().toString(36) + seq.toString(36);
}

export function list() { return read(); }
export function get(cid) { return read().find(x => x.id === cid) || null; }

export function add(item) {
  const list = read();
  const rec = {
    id: id(),
    name: item.name || '未命名组件',
    kind: item.kind || 'default',
    glb: item.glb,
    img: item.img || '',
    createdAt: Date.now(),
    preset: !!item.preset,
  };
  list.unshift(rec);
  write(list);
  window.dispatchEvent(new CustomEvent('library:changed'));
  return rec;
}

export function remove(cid) {
  write(read().filter(x => x.id !== cid));
  window.dispatchEvent(new CustomEvent('library:changed'));
}

export function count() { return read().length; }
