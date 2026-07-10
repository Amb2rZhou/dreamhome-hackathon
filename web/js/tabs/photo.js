// 拍照：<input capture> 调相机 → 客户端缩到 1024px → 同 TRELLIS 管线
import { downscale, fileToDataURL } from '../imgutil.js';
import { imageToComponent } from '../pipeline.js';
import { toast } from '../toast.js';
import { cachedGlbUrl } from '../glbcache.js';

let cleanups = [];
let currentUri = null;
function on(t, ev, fn, opts) { t.addEventListener(ev, fn, opts); cleanups.push(() => t.removeEventListener(ev, fn, opts)); }

export async function mount(view) {
  view.innerHTML = `
    <div class="view-pad stack">
      <div>
        <div class="section-title">📷 拍照 · 逛店/朋友家看到就拍下来</div>
        <div class="hint">对着心动的家具拍一张，AI 直接建成 3D 组件。建议干净背景、主体居中。</div>
      </div>

      <label class="dropzone" for="cam">
        <div class="dz-ico">📸</div>
        <div class="dz-title">拍摄家具</div>
        <div class="dz-sub">点此调用相机（也可从相册选）</div>
      </label>
      <input type="file" id="cam" accept="image/*" capture="environment" hidden>

      <div id="stage" hidden class="stack">
        <img id="preview" class="preview-img" alt="待摘抄">
        <input id="name" class="name-input" placeholder="给它起个名，如：原木小圆凳">
        <div class="btn-row">
          <button class="btn" id="gen">生成 3D 组件</button>
          <button class="btn subtle" id="reset">重拍</button>
        </div>
      </div>

      <div id="result" hidden class="stack">
        <div class="section-title">✓ 已生成</div>
        <div class="inline-mv" id="mvwrap"></div>
        <div class="btn-row">
          <button class="btn ghost" id="toLib">在组件库查看</button>
          <button class="btn subtle" id="again">再拍一件</button>
        </div>
      </div>
    </div>`;

  const nameEl = view.querySelector('#name');
  nameEl.style.cssText = 'width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--paper-2);font:inherit;color:var(--ink);';

  const cam = view.querySelector('#cam');
  const stage = view.querySelector('#stage');
  const preview = view.querySelector('#preview');
  const result = view.querySelector('#result');
  const dz = view.querySelector('.dropzone');

  const resetAll = () => { currentUri = null; cam.value = ''; stage.hidden = true; result.hidden = true; dz.hidden = false; nameEl.value = ''; };

  on(cam, 'change', async () => {
    const f = cam.files[0];
    if (!f) return;
    try {
      const raw = await fileToDataURL(f);
      currentUri = await downscale(raw, 1024, 0.9); // 客户端缩到 1024px
      preview.src = currentUri; stage.hidden = false; result.hidden = true; dz.hidden = true;
    } catch (e) { toast('读取照片失败：' + (e.message || e), 'err'); }
  });

  on(view.querySelector('#gen'), 'click', async () => {
    if (!currentUri) return;
    const btn = view.querySelector('#gen'); btn.disabled = true;
    try {
      const rec = await imageToComponent(currentUri, { name: nameEl.value });
      const src = await cachedGlbUrl(rec.glb);
      view.querySelector('#mvwrap').innerHTML = `<model-viewer src="${src}" camera-controls auto-rotate touch-action="pan-y" loading="eager" shadow-intensity="1" ar ar-modes="webxr scene-viewer quick-look" environment-image="neutral"></model-viewer>`;
      stage.hidden = true; result.hidden = false;
    } catch (e) { /* pipeline 已 toast */ }
    finally { btn.disabled = false; }
  });
  on(view.querySelector('#reset'), 'click', resetAll);
  on(view.querySelector('#again'), 'click', resetAll);
  on(view.querySelector('#toLib'), 'click', () => document.querySelector('.tab[data-tab="library"]').click());
}

export function unmount() { cleanups.forEach(fn => fn()); cleanups = []; currentUri = null; }
