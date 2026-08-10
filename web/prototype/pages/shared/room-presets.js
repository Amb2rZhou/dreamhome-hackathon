// 房间尺寸预设：户型自定义链路（room-setup 中间页 → my-home 生成）的尺寸单一真源。
//
// 为什么单独一个模块：同一个 templateId 的尺寸原本散在两处且已经漂移——
//   template-preview-3d.js 的 SPECS 里 bay-bedroom 是 6×5、standard-bedroom 是 7×5，
//   而 my-home 侧实际生成的房间是 4.2×5.2 / 5×5。
// 中间页的滑杆初始值必须跟「生成出来的房间」一致，否则用户调完发现对不上。
// 所以这里的值一律取 my-home TEMPLATES 里的真值：
//   - 有内置 realScene 的（bay/standard）取 realScene.room，不取 envelope
//     （bay-bedroom 的 envelope.depth 6.15 含 0.95 阳台进深，不是房间本身）
//   - 其余四个取 envelope.width/depth
// my-home 载入时会拿 TEMPLATES 跟这里对一遍并 console.warn，防止将来再漂。

export const ROOM_PRESETS = {
  'wide-living':      { name: '横厅客厅',     w: 9,   d: 5.5, h: 2.8 },
  'long-living':      { name: '窄长客厅',     w: 5,   d: 9,   h: 2.8 },
  'square-lounge':    { name: '方形会客厅',   w: 8,   d: 7,   h: 2.8 },
  'l-living':         { name: 'L形客厅',      w: 8,   d: 7,   h: 2.8 },
  'bay-bedroom':      { name: '飘窗卧室',     w: 4.2, d: 5.2, h: 2.8 },
  'standard-bedroom': { name: '普通方形卧室', w: 5,   d: 5,   h: 2.8 },
};

// 滑杆区间。上限 14m 覆盖到大平层横厅，下限 2.4m 是能放下一张床的最小房间；
// 层高 2.2–3.6 覆盖从老公房到复式，步长 0.1m 与房产证上的标注精度一致。
export const ROOM_LIMITS = {
  w: [2.4, 14],
  d: [2.4, 14],
  h: [2.2, 3.6],
  step: 0.1,
};

export const isPresetId = (id) => Object.prototype.hasOwnProperty.call(ROOM_PRESETS, id);

const clampOne = (value, [min, max], fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number * 10) / 10)); // 先按步长归整再夹取，URL 里传 4.27 也能落回 4.3
};

// 双端都用它：中间页出参前夹一次，my-home 收参后再夹一次（URL 是用户可改的，不能信）
export function clampRoom(dims = {}, templateId = '') {
  const base = ROOM_PRESETS[templateId] || { w: 5, d: 5, h: 2.8 };
  return {
    w: clampOne(dims.w, ROOM_LIMITS.w, base.w),
    d: clampOne(dims.d, ROOM_LIMITS.d, base.d),
    h: clampOne(dims.h, ROOM_LIMITS.h, base.h),
  };
}

export const presetRoom = (templateId) => {
  const preset = ROOM_PRESETS[templateId];
  return preset ? { w: preset.w, d: preset.d, h: preset.h } : null;
};

// 与模板默认值是否一致——中间页用它决定「重置」按钮是否可点
export const isDefaultRoom = (templateId, dims) => {
  const preset = presetRoom(templateId);
  if (!preset || !dims) return true;
  return Math.abs(preset.w - dims.w) < 0.05 && Math.abs(preset.d - dims.d) < 0.05 && Math.abs(preset.h - dims.h) < 0.05;
};
