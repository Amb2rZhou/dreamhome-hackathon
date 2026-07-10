// 3D 空间（占位）：three.js 房间 · 从组件库添加 · 点选/拖动/旋转/缩放/删除 ·
// 布局持久化 · 语音指挥 · 手绘户型 → 重建墙体
// 将在第三阶段用 vendor/ 里的 three@0.160 实现。
export async function mount(view) {
  view.innerHTML = `
    <div class="view-pad">
      <div class="placeholder">
        <div class="ph-ico">🛋️</div>
        <div class="ph-title">我的 3D 空间</div>
        <div>把组件库里的家具摆进自己的房间：拖动 / 旋转 / 缩放，语音指挥，手绘户型自动建墙。</div>
        <div class="ph-badge">第三阶段接入 · three.js 房间编辑器</div>
      </div>
    </div>`;
}
export function unmount() {}
