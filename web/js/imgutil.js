// 图片工具：文件→dataURI、缩放、缩略图
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

// 缩放到最长边 <= maxSize，输出 JPEG dataURI（减小 trellis 请求体）
export async function downscale(dataURL, maxSize = 1024, quality = 0.9) {
  const img = await loadImage(dataURL);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  if (scale >= 1) return dataURL;
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

// 正方形缩略图 dataURI（组件库封面）
export async function thumbnail(dataURL, size = 256) {
  const img = await loadImage(dataURL);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efeae2'; ctx.fillRect(0, 0, size, size);
  const s = Math.min(img.width, img.height);
  const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
  ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}
