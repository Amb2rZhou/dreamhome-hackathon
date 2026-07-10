// 画画（占位）：线稿 → 实时平面设计图（flux 双发对冲）→ 语音修改词迭代 → 3D 组件
// 将在第二阶段接入 flux/dev/image-to-image（草稿）+ flux-control-lora-canny（精修）双发管线。
export async function mount(view) {
  view.innerHTML = `
    <div class="view-pad">
      <div class="placeholder">
        <div class="ph-ico">✏️</div>
        <div class="ph-title">边画边生成</div>
        <div>手绘线稿 → 实时平面设计图 → 说中文修改词迭代 → 满意后生成 3D 组件。</div>
        <div class="ph-badge">第二阶段接入 · flux 双发对冲管线</div>
      </div>
    </div>`;
}
export function unmount() {}
