# 原型视觉/IP 升级实现计划(包公球全程陪伴 + 刷一刷投喂闭环)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准的 spec(`docs/superpowers/specs/2026-07-16-prototype-mascot-ip-upgrade-design.md`)把包公球升级为全程陪伴的小管家,并把「刷一刷」重做为圈选投喂 → 后台打造 → 通知收货的完整 mock 闭环。

**Architecture:** 新增共享组件 `pages/shared/mascot.js`+`mascot.css`(六态悬浮 widget,纯 CSS 动画),`asset-library-data.js` 增加 crafted-assets localStorage 层,「刷一刷」整页重写为 scroll-snap mock 视频流,其余页面轻改接入 widget。

**Tech Stack:** 原生 HTML/CSS/JS(ES module),零外部依赖,localStorage 持久化。仓库无测试框架,验证方式为本地 HTTP 服务器 + 浏览器手工走查(仓库 README 规定的流程)。

**测试约定:** 每个 Task 的验证步骤都假设本地服务器已运行:

```bash
python3 -m http.server 5178 --directory web   # 从仓库根目录执行,已在跑则跳过
```

**路径约定:** 以下所有相对路径省略仓库根前缀,如 `web/prototype/pages/...`。原型页面互相引用一律相对路径(GitHub Pages 有 `/dreamhome-hackathon/` 前缀,禁止 `/pages/...` 根路径)。

---

### Task 1: 素材迁移 + 3MB 大图清理

**Files:**
- Create: `web/prototype/assets/mascot/states/mascot-{initial,idle,thinking,working,happy,sleeping}.png`(从 `web/assets/mascot/` 复制)
- Create: `web/prototype/assets/gallery/{sofa,armchair,cabinet,chair,lamp,plant}.jpg`(从 `web/assets/gallery/` 复制)
- Modify: `web/prototype/pages/my-home/index.html:217`
- Delete: `web/prototype/assets/mascot/mascot-idle.png`(3MB 大图)

- [ ] **Step 1: 复制素材**

```bash
cd ~/dreamhome-hackathon
cp web/assets/mascot/mascot-{initial,idle,thinking,working,happy,sleeping}.png web/prototype/assets/mascot/states/
mkdir -p web/prototype/assets/gallery
cp web/assets/gallery/*.jpg web/prototype/assets/gallery/
ls web/prototype/assets/mascot/states/   # 应看到 6 张 png(working 原已存在,被同名覆盖为相同文件)
ls web/prototype/assets/gallery/          # 应看到 6 张 jpg
```

- [ ] **Step 2: 把 my-home 空态图从 3MB 大图换成六态 sleeping**

`web/prototype/pages/my-home/index.html` 第 217 行,把:

```html
<img src="../../assets/mascot/mascot-idle.png" alt="" aria-hidden="true">
```

替换为(空态语义用 sleeping,符合 spec):

```html
<img src="../../assets/mascot/states/mascot-sleeping.png" alt="" aria-hidden="true">
```

- [ ] **Step 3: 删除 3MB 大图并确认无残留引用**

```bash
git rm web/prototype/assets/mascot/mascot-idle.png
grep -rn "mascot/mascot-idle" web/prototype/ ; echo "exit=$?"
```

Expected: grep 无匹配输出,`exit=1`(唯一引用已在 Step 2 改掉;`mascot-idle-sway` 是 keyframes 名不含此路径,不会误匹配)。

- [ ] **Step 4: 浏览器验证**

打开 `http://127.0.0.1:5178/prototype/pages/my-home/index.html`,把收藏清空的方法:DevTools Console 执行 `localStorage.removeItem('dreamhome.asset-library.v1'); location.reload()`。户型收藏空态应显示 sleeping 包公球小图,Network 面板无 404。

- [ ] **Step 5: Commit**

```bash
git add web/prototype/assets/mascot/states web/prototype/assets/gallery web/prototype/pages/my-home/index.html
git commit -m "chore(prototype): 六态包公球与gallery素材入原型,移除3MB大图"
```

---

### Task 2: 共享包公球组件

**Files:**
- Create: `web/prototype/pages/shared/mascot.css`
- Create: `web/prototype/pages/shared/mascot.js`

- [ ] **Step 1: 写 `web/prototype/pages/shared/mascot.css`**

完整文件内容:

```css
/* 包公球悬浮 widget:六态、呼吸浮动、抡锤、Zzz、队列徽标、通知胶囊 */
.mascot-widget { position: absolute; z-index: 30; width: 64px; pointer-events: none; }
.mascot-widget[hidden] { display: none; }
.mascot-widget[data-dock="right"] { right: 8px; top: 38%; }
.mascot-widget[data-dock="bottom-right"] { right: 10px; bottom: calc(var(--dh-tabbar-safe-space, 100px) + 6px); }
.mascot-face { display: block; width: 64px; height: 64px; object-fit: contain; border-radius: 50%;
  background: radial-gradient(circle at 50% 42%, rgba(255,255,255,.92), rgba(238,245,237,.78));
  box-shadow: 0 8px 20px rgba(44,59,45,.22), 0 0 0 3px rgba(255,255,255,.6);
  animation: mascot-float 3s ease-in-out infinite; }
.mascot-face.mascot-pop { animation: mascot-float 3s ease-in-out infinite, mascot-pop .45s cubic-bezier(.34,1.56,.64,1); }
.mascot-widget[data-state="working"] .mascot-face { animation: mascot-float 3s ease-in-out infinite, mascot-shake 1s ease-in-out infinite; }
.mascot-hammer { display: none; position: absolute; right: -6px; top: -10px; font-size: 20px; transform-origin: 20% 90%; animation: mascot-knock 1s ease-in-out infinite; }
.mascot-widget[data-state="working"] .mascot-hammer { display: block; }
.mascot-zzz { display: none; position: absolute; right: -2px; top: -14px; color: #8fa48a; font-size: 13px; font-weight: 800; animation: mascot-zzz 2.4s ease-in-out infinite; }
.mascot-widget[data-state="sleeping"] .mascot-zzz { display: block; }
.mascot-badge { position: absolute; top: -4px; right: -2px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
  background: #be6959; color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center;
  box-shadow: 0 3px 8px rgba(44,59,45,.3); }
.mascot-badge[hidden] { display: none; }
.mascot-notice { position: absolute; z-index: 40; top: 56px; left: 50%; transform: translateX(-50%) translateY(-12px); opacity: 0;
  display: flex; gap: 9px; align-items: center; width: max-content; max-width: 82%; padding: 8px 14px 8px 8px;
  border: 0; border-radius: 999px; background: rgba(255,255,255,.96); box-shadow: 0 10px 26px rgba(44,59,45,.24);
  font: inherit; font-size: 12px; font-weight: 700; color: #2c3b2d; cursor: pointer; transition: .3s ease; pointer-events: none; }
.mascot-notice.show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
.mascot-notice[hidden] { display: none; }
.mascot-notice img { width: 30px; height: 30px; object-fit: contain; }
@keyframes mascot-float { 0%,100% { translate: 0 0; } 50% { translate: 0 -6px; } }
@keyframes mascot-pop { 0% { scale: .72; } 60% { scale: 1.12; } 100% { scale: 1; } }
@keyframes mascot-shake { 0%,100% { rotate: 0deg; } 25% { rotate: -4deg; } 75% { rotate: 4deg; } }
@keyframes mascot-knock { 0%,100% { rotate: 0deg; } 50% { rotate: -42deg; } }
@keyframes mascot-zzz { 0% { opacity: 0; translate: 0 2px; } 40% { opacity: 1; } 100% { opacity: 0; translate: 6px -8px; } }
@media (prefers-reduced-motion: reduce) {
  .mascot-face, .mascot-face.mascot-pop, .mascot-widget[data-state="working"] .mascot-face,
  .mascot-hammer, .mascot-zzz { animation: none !important; }
  .mascot-notice { transition: none; }
}
```

- [ ] **Step 2: 写 `web/prototype/pages/shared/mascot.js`**

完整文件内容:

```js
// 包公球共享组件。宿主元素需 position:relative(各页 .dh-screen / .screen 均满足)。
const STATE_NAMES = ['initial', 'idle', 'thinking', 'working', 'happy', 'sleeping'];
const stateUrl = (state) => new URL(`../../assets/mascot/states/mascot-${state}.png`, import.meta.url).href;

export function createMascot(host, options = {}) {
  const widget = document.createElement('div');
  widget.className = 'mascot-widget';
  widget.dataset.dock = options.dock || 'right';
  widget.innerHTML = `
    <img class="mascot-face" src="${stateUrl('idle')}" alt="包公球" />
    <span class="mascot-hammer" aria-hidden="true">🔨</span>
    <span class="mascot-zzz" aria-hidden="true">Zz</span>
    <span class="mascot-badge" hidden>0</span>`;
  const notice = document.createElement('button');
  notice.type = 'button';
  notice.className = 'mascot-notice';
  notice.hidden = true;
  host.append(widget, notice);

  STATE_NAMES.forEach((state) => { new Image().src = stateUrl(state); });

  const face = widget.querySelector('.mascot-face');
  const badge = widget.querySelector('.mascot-badge');
  let happyTimer = null;
  let sleepTimer = null;
  let noticeTimer = null;
  let onNoticeTap = null;

  function setState(state, { then } = {}) {
    if (!STATE_NAMES.includes(state)) return;
    clearTimeout(happyTimer);
    widget.dataset.state = state;
    face.src = stateUrl(state);
    face.classList.remove('mascot-pop');
    void face.offsetWidth; /* 强制 reflow,重启弹跳动画 */
    face.classList.add('mascot-pop');
    if (state === 'happy' && then) happyTimer = setTimeout(() => setState(then), 1200);
    if (state === 'idle') armSleep(); else clearTimeout(sleepTimer);
  }
  function armSleep() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => { if (widget.dataset.state === 'idle') setState('sleeping'); }, 30000);
  }
  function wake() {
    if (widget.dataset.state === 'sleeping') setState('idle');
    else if (widget.dataset.state === 'idle') armSleep();
  }
  ['pointerdown', 'keydown', 'scroll'].forEach((type) =>
    document.addEventListener(type, wake, { passive: true, capture: true }));

  function queue(count) { badge.hidden = count <= 0; badge.textContent = count; }
  function dismiss() {
    notice.classList.remove('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 300);
  }
  function notify({ title, onTap, duration = 6000 } = {}) {
    notice.innerHTML = `<img src="${stateUrl('happy')}" alt="" /><b>${title}</b>`;
    onNoticeTap = onTap || null;
    notice.hidden = false;
    requestAnimationFrame(() => notice.classList.add('show'));
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(dismiss, duration);
  }
  notice.addEventListener('click', () => { const handler = onNoticeTap; dismiss(); if (handler) handler(); });

  setState(options.state || 'idle');
  return {
    el: widget,
    setState,
    queue,
    notify,
    dock(position) { widget.dataset.dock = position; },
    show() { widget.hidden = false; },
    hide() { widget.hidden = true; },
  };
}
```

- [ ] **Step 3: 浏览器烟囱测试(组件尚无页面接入,用 Console 驱动)**

打开 `http://127.0.0.1:5178/prototype/pages/inspiration-library/index.html`,DevTools Console 逐行执行:

```js
const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '../shared/mascot.css'; document.head.append(link);
const { createMascot } = await import('../shared/mascot.js');
const m = createMascot(document.querySelector('.dh-screen'), { dock: 'bottom-right' });
m.setState('working');   // 应显示 working 图 + 🔨 敲击 + 本体微晃
m.queue(2);              // 右上角红色徽标显示 2
m.setState('happy', { then: 'idle' });  // happy 弹跳,约 1.2s 后自动回 idle
m.notify({ title: '2 件 3D 资产已打造好 ✨', onTap: () => console.log('tapped') });  // 顶部滑入胶囊,点击打印 tapped 并收起
```

Expected: 上述表现全部符合,Console 无报错;等 30s 不动,idle 自动切 sleeping 并飘 Zz,点击页面任意处唤醒回 idle。

- [ ] **Step 4: Commit**

```bash
git add web/prototype/pages/shared/mascot.css web/prototype/pages/shared/mascot.js
git commit -m "feat(prototype): 包公球共享组件(六态/动效/队列徽标/通知胶囊)"
```

---

### Task 3: crafted-assets 数据层

**Files:**
- Modify: `web/prototype/pages/shared/asset-library-data.js`

- [ ] **Step 1: 在文件顶部常量区加 key**

在第 1 行 `const FAVORITES_KEY = 'dreamhome.asset-library.v1';` 之后加:

```js
const CRAFTED_KEY = 'dreamhome.crafted-assets.v1';
```

- [ ] **Step 2: 在 `export const ASSET_BY_ID = ...`(第 83 行)之后追加 crafted API**

```js
function readCrafted() {
  try {
    const stored = JSON.parse(localStorage.getItem(CRAFTED_KEY) || '{}');
    return Array.isArray(stored.items) ? stored.items : [];
  } catch {
    return [];
  }
}

function writeCrafted(items) {
  localStorage.setItem(CRAFTED_KEY, JSON.stringify({ version: 1, items }));
}

function registerCrafted(item) {
  if (ASSET_BY_ID.has(item.id)) return;
  COMPONENT_ASSETS.unshift(item);
  ASSET_BY_ID.set(item.id, item);
}

export function getCraftedAssets() {
  return readCrafted();
}

export function addCraftedAsset(item) {
  const crafted = { kind: 'furniture', source: 'discover', sourceType: 'discover', isNew: true, createdAt: Date.now(), dimensions: [1, .8, .6], ...item };
  writeCrafted([crafted, ...readCrafted()]);
  registerCrafted(crafted);
  return crafted;
}

export function markCraftedSeen(id) {
  writeCrafted(readCrafted().map((item) => (item.id === id ? { ...item, isNew: false } : item)));
  const registered = ASSET_BY_ID.get(id);
  if (registered) registered.isNew = false;
}

// 模块加载即把已打造资产并入目录(倒序遍历保证最新的排最前)
readCrafted().slice().reverse().forEach(registerCrafted);
```

- [ ] **Step 3: 浏览器验证(持久化 + 目录合并 + 收藏兼容)**

打开 `http://127.0.0.1:5178/prototype/pages/inspiration-library/index.html`,Console 执行:

```js
const data = await import('../shared/asset-library-data.js');
const item = data.addCraftedAsset({ id: `crafted-sofa-${Date.now()}`, name: '奶油布艺沙发', category: 'sofa', primitive: 'sofa', color: '#e2ddd0', accent: '#af9f8e' });
data.getAssets('furniture', 'sofa')[0].name;       // '奶油布艺沙发'(排在最前)
data.getAsset(item.id).isNew;                      // true
data.toggleFavorite(item.id); data.getFavorites().has(item.id);  // true(收藏兼容 crafted)
data.markCraftedSeen(item.id); data.getAsset(item.id).isNew;     // false
```

然后刷新页面重新 `import`,`getCraftedAssets().length >= 1` 且 `getAssets('furniture','sofa')[0].source === 'discover'`(持久化生效)。验证完清理:`localStorage.removeItem('dreamhome.crafted-assets.v1')`。

- [ ] **Step 4: Commit**

```bash
git add web/prototype/pages/shared/asset-library-data.js
git commit -m "feat(prototype): crafted-assets localStorage 数据层,刷一刷产出并入组件目录"
```

---

### Task 4: 「刷一刷」整页重做

**Files:**
- Rewrite: `web/prototype/pages/discover/index.html`(整文件替换,原 6 行占位页)

- [ ] **Step 1: 用以下完整内容覆盖 `web/prototype/pages/discover/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DreamHome · 刷一刷</title>
<link rel="stylesheet" href="./dreamhome-d-system.css" />
<link rel="stylesheet" href="../shared/five-tabbar.css" />
<link rel="stylesheet" href="../shared/mascot.css" />
<style>
body { margin: 0; min-width: 320px; background: var(--dh-bg-canvas); }
.preview-stage { min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; box-sizing: border-box; }
@media (max-width: 420px) { .preview-stage { min-height: 100svh; padding: 18px 10px; } }
.discover-shell .dh-statusbar { position: relative; z-index: 10; color: #fff; }
/* 视频流:铺满屏幕,竖向贴屏滑动 */
.feed { position: absolute; inset: 0; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; }
.feed::-webkit-scrollbar { display: none; }
.video-card { position: relative; height: 100%; scroll-snap-align: start; scroll-snap-stop: always; overflow: hidden;
  background: radial-gradient(circle at 70% 24%, rgba(255,255,255,.16), transparent 42%), linear-gradient(165deg, var(--bg1), var(--bg2)); }
.prop { position: absolute; border-radius: 14px; box-shadow: 0 14px 30px rgba(0,0,0,.35); object-fit: cover; }
.card-caption { position: absolute; left: 14px; right: 88px; bottom: calc(var(--dh-tabbar-safe-space) + 6px); color: #fff; text-shadow: 0 1px 5px rgba(0,0,0,.45); }
.card-caption b { display: block; font-size: 13px; margin-bottom: 3px; }
.card-caption span { font-size: 11px; opacity: .92; line-height: 1.5; }
/* 右侧动作栏 */
.action-rail { position: absolute; z-index: 12; right: 10px; bottom: calc(var(--dh-tabbar-safe-space) + 10px); display: grid; gap: 14px; justify-items: center; }
.rail-btn { display: grid; gap: 3px; justify-items: center; border: 0; padding: 0; background: transparent; color: #fff; font: inherit; font-size: 9px; font-weight: 700; cursor: pointer; text-shadow: 0 1px 4px rgba(0,0,0,.4); }
.rail-btn i { font-style: normal; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-size: 18px; background: rgba(0,0,0,.28); }
.rail-btn.is-active i { background: var(--dh-color-sage-600); }
/* 圈选模式 */
.lasso-layer { position: absolute; inset: 0; z-index: 20; display: none; background: rgba(10,16,11,.4); cursor: crosshair; touch-action: none; }
.discover-shell.is-selecting .lasso-layer { display: block; }
.lasso-hint { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); padding: 7px 14px; border-radius: 999px; background: rgba(255,255,255,.92); color: #2c3b2d; font-size: 11px; font-weight: 700; pointer-events: none; }
.lasso-box { position: absolute; border: 3px dashed #ffd76e; border-radius: 16px; background: rgba(255,215,110,.12); pointer-events: none; }
/* 圈中后飞向包公球的克隆 */
.fly-clone { position: fixed; z-index: 80; border-radius: 12px; object-fit: cover; pointer-events: none;
  transition: transform .7s cubic-bezier(.3,.7,.3,1), opacity .7s ease; }
.discover-toast { position: absolute; z-index: 40; left: 50%; bottom: calc(var(--dh-tabbar-safe-space) + 18px); transform: translateX(-50%) translateY(8px); opacity: 0; padding: 9px 13px; border-radius: 999px; background: rgba(29,36,31,.9); color: #fff; font-size: 11px; font-weight: 600; pointer-events: none; transition: .2s ease; }
.discover-toast.show { opacity: 1; transform: translateX(-50%); }
@media (prefers-reduced-motion: reduce) { .fly-clone { transition: none; } }
</style>
</head>
<body>
<main class="preview-stage">
<section class="dh-phone-shell discover-shell" id="discoverShell">
  <div class="dh-screen">
    <div class="feed" id="feed">
      <article class="video-card" style="--bg1:#8a9b85;--bg2:#3e4f40">
        <img class="prop" data-item="sofa" src="../../assets/gallery/sofa.jpg" alt="奶油布艺沙发" style="left:8%;bottom:30%;width:56%;aspect-ratio:4/3" />
        <img class="prop" data-item="lamp" src="../../assets/gallery/lamp.jpg" alt="落地阅读灯" style="right:8%;bottom:44%;width:24%;aspect-ratio:3/4" />
        <div class="card-caption"><b>@奶油家居日记</b><span>60m² 小家的治愈客厅,沙发真的巨舒服 #奶油风</span></div>
      </article>
      <article class="video-card" style="--bg1:#9aa98c;--bg2:#55684f">
        <img class="prop" data-item="armchair" src="../../assets/gallery/armchair.jpg" alt="复古扶手椅" style="left:14%;bottom:32%;width:44%;aspect-ratio:1" />
        <img class="prop" data-item="plant" src="../../assets/gallery/plant.jpg" alt="龟背竹盆栽" style="right:10%;bottom:38%;width:26%;aspect-ratio:3/4" />
        <div class="card-caption"><b>@阳台改造中</b><span>秋天的阅读角就该这样,一椅一绿植 #治愈系</span></div>
      </article>
      <article class="video-card" style="--bg1:#a89a83;--bg2:#5c5142">
        <img class="prop" data-item="cabinet" src="../../assets/gallery/cabinet.jpg" alt="原木斗柜" style="left:20%;bottom:26%;width:56%;aspect-ratio:4/3" />
        <div class="card-caption"><b>@木作研究所</b><span>入户第一眼,原木斗柜收纳力惊人 #玄关</span></div>
      </article>
      <article class="video-card" style="--bg1:#93a48e;--bg2:#46543f">
        <img class="prop" data-item="chair" src="../../assets/gallery/chair.jpg" alt="曲木单椅" style="left:26%;bottom:30%;width:44%;aspect-ratio:3/4" />
        <div class="card-caption"><b>@一把好椅子</b><span>百看不厌的曲木椅,餐厨通用 #经典设计</span></div>
      </article>
    </div>
    <div class="dh-statusbar"><span>9:41</span><span class="dh-dynamic-island"></span><span class="dh-status-icons">▮◔</span></div>
    <div class="action-rail">
      <button class="rail-btn" type="button" data-like><i>♡</i>赞</button>
      <button class="rail-btn" type="button"><i>💬</i>评论</button>
      <button class="rail-btn" type="button"><i>↗</i>分享</button>
      <button class="rail-btn" type="button" id="lassoToggle"><i>◌</i>圈选</button>
    </div>
    <div class="lasso-layer" id="lassoLayer"><span class="lasso-hint">圈住喜欢的家具,松手交给包公球</span></div>
    <div class="discover-toast" id="discoverToast" role="status" aria-live="polite"></div>
    <nav class="dh-tabbar dh-tabbar--five" aria-label="主功能导航"><a class="dh-tab" href="../draw/index.html" aria-label="画一笔"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/draw.svg" alt="" /></span></a><a class="dh-tab" href="../capture/index.html" aria-label="拍一张"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/capture.svg" alt="" /></span></a><a class="dh-tab dh-tab--core" href="../inspiration-library/index.html" aria-label="灵感库"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/inspiration.svg" alt="" /></span></a><a class="dh-tab dh-tab--active" href="./index.html" aria-label="刷一刷" aria-current="page"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/discover.svg" alt="" /></span></a><a class="dh-tab" href="../my-home/index.html" aria-label="我的家"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/my-home.svg" alt="" /></span></a></nav>
    <div class="dh-home-indicator" aria-hidden="true"></div>
  </div>
</section>
</main>
<script type="module">
import { createMascot } from '../shared/mascot.js';
import { addCraftedAsset } from '../shared/asset-library-data.js';

// 圈选目标 → crafted 资产字段(primitive/color/accent 供灵感库沿用现有 visual 渲染)
const FEED_ITEMS = {
  sofa:     { name: '奶油布艺沙发', category: 'sofa',     primitive: 'sofa',    color: '#e2ddd0', accent: '#af9f8e' },
  lamp:     { name: '落地阅读灯',   category: 'lighting', primitive: 'lamp',    color: '#d5a25d', accent: '#fff2cf' },
  armchair: { name: '复古扶手椅',   category: 'seating',  primitive: 'chair',   color: '#8da38a', accent: '#d5e1d0' },
  plant:    { name: '龟背竹盆栽',   category: 'decor',    primitive: 'plant',   color: '#637b59', accent: '#cfb58d' },
  cabinet:  { name: '原木斗柜',     category: 'cabinet',  primitive: 'cabinet', color: '#ba8f63', accent: '#e2c29a' },
  chair:    { name: '曲木单椅',     category: 'seating',  primitive: 'chair',   color: '#7f5b44', accent: '#c8a682' },
};

const shell = document.getElementById('discoverShell');
const screen = shell.querySelector('.dh-screen');
const feed = document.getElementById('feed');
const lassoLayer = document.getElementById('lassoLayer');
const lassoToggle = document.getElementById('lassoToggle');
const toast = document.getElementById('discoverToast');
const mascot = createMascot(screen, { dock: 'right' });

let toastTimer = null;
function showToast(message) {
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

// —— 圈选 ————————————————————————
let lassoBox = null, startX = 0, startY = 0;
function setSelecting(on) {
  shell.classList.toggle('is-selecting', on);
  lassoToggle.classList.toggle('is-active', on);
}
lassoToggle.addEventListener('click', () => setSelecting(!shell.classList.contains('is-selecting')));

lassoLayer.addEventListener('pointerdown', (event) => {
  lassoLayer.setPointerCapture(event.pointerId);
  startX = event.clientX; startY = event.clientY;
  lassoBox = document.createElement('div');
  lassoBox.className = 'lasso-box';
  lassoLayer.appendChild(lassoBox);
  drawLasso(event);
});
lassoLayer.addEventListener('pointermove', (event) => { if (lassoBox) drawLasso(event); });
lassoLayer.addEventListener('pointerup', (event) => {
  if (!lassoBox) return;
  const rect = lassoBox.getBoundingClientRect();
  lassoBox.remove(); lassoBox = null;
  setSelecting(false);
  const hit = hitProp(rect);
  if (hit) feedToMascot(hit);
  else showToast('没圈到家具,再试一次');
});
lassoLayer.addEventListener('pointercancel', () => { lassoBox?.remove(); lassoBox = null; setSelecting(false); });

function drawLasso(event) {
  const layer = lassoLayer.getBoundingClientRect();
  const left = Math.min(startX, event.clientX) - layer.left;
  const top = Math.min(startY, event.clientY) - layer.top;
  Object.assign(lassoBox.style, {
    left: `${left}px`, top: `${top}px`,
    width: `${Math.abs(event.clientX - startX)}px`, height: `${Math.abs(event.clientY - startY)}px`,
  });
}

// 圈选框与当前屏内 prop 求交,重叠面积 ≥ prop 面积 30% 判定圈中
function hitProp(rect) {
  let best = null, bestRatio = .3;
  feed.querySelectorAll('.prop').forEach((prop) => {
    const box = prop.getBoundingClientRect();
    if (!box.width || box.bottom < 0 || box.top > innerHeight) return;
    const overlapW = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
    const overlapH = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
    if (overlapW <= 0 || overlapH <= 0) return;
    const ratio = (overlapW * overlapH) / (box.width * box.height);
    if (ratio >= bestRatio) { bestRatio = ratio; best = prop; }
  });
  return best;
}

// —— 投喂 → 打造 → 通知 ————————————————
let craftQueue = 0;
let doneCount = 0;

function flyToMascot(propEl) {
  const from = propEl.getBoundingClientRect();
  const to = mascot.el.getBoundingClientRect();
  const clone = propEl.cloneNode();
  clone.className = 'fly-clone';
  Object.assign(clone.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.appendChild(clone);
  requestAnimationFrame(() => {
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(.15)`;
    clone.style.opacity = '.15';
  });
  clone.addEventListener('transitionend', () => clone.remove());
  setTimeout(() => clone.remove(), 900); /* reduced-motion 下无 transitionend 的兜底 */
}

function feedToMascot(propEl) {
  const spec = FEED_ITEMS[propEl.dataset.item];
  if (!spec) return;
  flyToMascot(propEl);
  craftQueue += 1;
  mascot.queue(craftQueue);
  mascot.setState('happy', { then: 'working' });
  showToast(`包公球收到「${spec.name}」,开工!`);
  const craftMs = 8000 + Math.random() * 7000; /* mock 异步:接真后端时换成任务轮询 */
  setTimeout(() => {
    addCraftedAsset({ id: `crafted-${propEl.dataset.item}-${Date.now()}`, ...spec });
    doneCount += 1;
    craftQueue -= 1;
    mascot.queue(craftQueue);
    if (craftQueue === 0) {
      mascot.setState('happy', { then: 'idle' });
      mascot.notify({
        title: `${doneCount} 件 3D 资产已打造好 ✨`,
        onTap: () => { location.href = '../inspiration-library/index.html'; },
        duration: 10000,
      });
      doneCount = 0;
    }
  }, craftMs);
}
</script>
</body>
</html>
```

- [ ] **Step 2: 浏览器走查完整闭环**

打开 `http://127.0.0.1:5178/prototype/pages/discover/index.html`,依次确认:

1. 竖滑流:4 条"视频"逐屏贴屏滑动;包公球 idle 悬浮右侧,呼吸浮动,不挡滑动。
2. 点「圈选」:画面变暗出现提示;拖框圈住沙发松手 → 缩略图沿弧线飞向包公球 → happy 一闪转 working(🔨 敲击),徽标显示 1,toast「包公球收到…」。
3. 继续下滑刷第二条,再圈一件 → 徽标变 2,滑动不受打断。
4. 空圈(圈在背景上)→ toast「没圈到家具,再试一次」,不入队。
5. 等 8–15s × 2:全部完成后 happy → 顶部胶囊「2 件 3D 资产已打造好 ✨」→ 点胶囊跳转灵感库。
6. Console 无报错,Network 无 404。验证后清理:`localStorage.removeItem('dreamhome.crafted-assets.v1')`。

- [ ] **Step 3: Commit**

```bash
git add web/prototype/pages/discover/index.html
git commit -m "feat(prototype): 刷一刷重做——mock视频流+圈选投喂包公球+后台打造+完工通知"
```

---

### Task 5: 灵感库接入(包公球 + NEW 资产 + 空态)

**Files:**
- Modify: `web/prototype/pages/inspiration-library/index.html`

- [ ] **Step 1: head 里引入 mascot.css**

在第 9 行 `<link rel="stylesheet" href="../shared/five-tabbar.css" />` 之后加:

```html
  <link rel="stylesheet" href="../shared/mascot.css" />
```

- [ ] **Step 2: 页内 `<style>` 末尾(第 23 行 `@media(max-width:420px){...}` 之前)加 NEW 角标与空态样式**

```css
    .new-badge{position:absolute;z-index:3;left:4px;top:4px;padding:2px 5px;border-radius:6px;background:#be6959;color:#fff;font-size:8px;font-weight:800;letter-spacing:.04em;box-shadow:0 2px 5px rgba(44,59,45,.25)}
    .empty-state img{display:block;width:56px;height:56px;object-fit:contain;margin:0 auto 8px;opacity:.9}
```

- [ ] **Step 3: module script 改造(共 5 处)**

3a. 第 45 行 import 替换为:

```js
    import { COMPONENT_FAMILIES, FURNITURE_CATEGORIES, getAssets, getFavorites, toggleFavorite, getCraftedAssets, markCraftedSeen } from '../shared/asset-library-data.js';
    import { createMascot } from '../shared/mascot.js';
```

3b. 第 50 行 `let activeFurnitureCategory = 'table';` 替换为(有 NEW 资产时落地直接切到它的分类,演示不落空):

```js
    const newestCrafted = getCraftedAssets().find((item) => item.isNew);
    let activeFurnitureCategory = newestCrafted?.category || 'table';
```

3c. 第 53 行 `let toastTimer = null;` 之后加:

```js
    const mascot = createMascot(document.querySelector('.dh-screen'), { dock: 'bottom-right' });
```

3d. 第 64 行 `card()` 模板加 NEW 角标——整行替换为:

```js
    const card = (asset, className = 'component-card') => `<article class="${className}" data-asset="${asset.id}" tabindex="0">${asset.isNew ? '<span class="new-badge">NEW</span>' : ''}${favoriteButton(asset)}${visual(asset)}<b>${asset.name}</b></article>`;
```

3e. 第 100 行 click 处理器里,`const asset = event.target.closest('[data-asset]'); if (asset) showToast('长按可收藏组件');` 替换为(点 NEW 资产视为"已查看"):

```js
      const asset = event.target.closest('[data-asset]'); if (asset) { const target = getAssets().find((item) => item.id === asset.dataset.asset) || getCraftedAssets().find((item) => item.id === asset.dataset.asset); if (target?.isNew) { markCraftedSeen(target.id); showToast(`「${target.name}」已收进灵感库`); route(); return; } showToast('长按可收藏组件'); }
```

注意:`getAssets()` 不带参数时按现有实现返回空(它按 kind 过滤),所以这里第一分支实际由 `getCraftedAssets()` 命中即可,保留双查找是防守;等价简化写法也可接受:`const target = getCraftedAssets().find((item) => item.id === asset.dataset.asset);`。

3f. 第 91 行 `renderCatalog` 里空收藏文案,把:

```js
'<p class="empty-state">还没有收藏组件。长按卡片或点击心形即可收藏。</p>'
```

替换为(sleeping 包公球空态):

```js
`<p class="empty-state"><img src="../../assets/mascot/states/mascot-sleeping.png" alt="" aria-hidden="true">包公球在打盹……还没有收藏组件。<br>长按卡片或点击心形即可收藏。</p>`
```

- [ ] **Step 4: 浏览器验证**

1. 清空存储后打开灵感库:右下角 idle 包公球悬浮于 tabbar 上方,不遮五个 tab;30s 不动切 sleeping。
2. 去刷一刷圈一件沙发等它完工 → 点通知胶囊跳回灵感库:家具区自动落在「沙发」分类,新资产排第一且带红色 NEW 角标。
3. 点该资产:toast「已收进灵感库」,NEW 角标消失;刷新后仍无 NEW(markCraftedSeen 持久化)。
4. 访问 `…/inspiration-library/index.html#favorites`(无收藏时):空态出现 sleeping 包公球小图。
5. Console/Network 干净。

- [ ] **Step 5: Commit**

```bash
git add web/prototype/pages/inspiration-library/index.html
git commit -m "feat(prototype): 灵感库接入包公球与NEW资产展示,空态改sleeping"
```

---

### Task 6: 我的家接入包公球状态流

**Files:**
- Modify: `web/prototype/pages/my-home/index.html`

- [ ] **Step 1: head 引入 mascot.css**

第 9 行 `<link rel="stylesheet" href="./dreamhome-d-system.css" />` 之后加:

```html
  <link rel="stylesheet" href="../shared/mascot.css" />
```

- [ ] **Step 2: module script 加 import(第 110 行同组)**

在 `import { FURNITURE_CATEGORIES, ... } from '../shared/asset-library-data.js';` 之后加:

```js
    import { createMascot } from '../shared/mascot.js';
```

- [ ] **Step 3: 创建 widget(第 155 行 `const ui = ...` 之后)**

```js
    const mascotWidget = createMascot(document.querySelector('.dh-screen'), { dock: 'bottom-right', state: 'thinking' });
```

- [ ] **Step 4: `updatePhases()`(第 221 行)接管 widget 显隐与状态**

整行替换为:

```js
    function updatePhases() { ui.setupPhase.style.display = state.phase === 'setup' ? 'flex' : 'none'; ui.generationPhase.classList.toggle('is-visible', ['submitting','polling','error'].includes(state.phase)); ui.editorPhase.classList.toggle('is-visible', state.phase === 'editor'); if (state.phase === 'setup') { mascotWidget.show(); mascotWidget.setState('thinking'); } else if (state.phase === 'editor') { mascotWidget.show(); } else { mascotWidget.hide(); } }
```

(生成中间态隐藏角落 widget,舞台中央已有原 generation-orbit 大号包公球,避免同屏两只。)

- [ ] **Step 5: 生成成功 happy 一闪(第 224 行 `pollJob`)**

在 ready 分支的 `tell('3D 户型已生成，可以开始摆放');` 之前插入:

```js
mascotWidget.setState('happy', { then: 'idle' });
```

替换后该分支为:`... state.phase='editor'; updatePhases(); initEditor(); mascotWidget.setState('happy', { then: 'idle' }); tell('3D 户型已生成，可以开始摆放'); return;`

- [ ] **Step 6: 浏览器验证**

1. 打开我的家:选户型阶段右下角 thinking 包公球。
2. 选「一室一厅」点生成:角落 widget 隐藏,中央原有装修动画正常(不回归破坏)。
3. mock 生成完成进编辑器:widget 重现并 happy 弹跳一下回 idle;编辑器旋转/摆放操作不被遮挡。
4. Console/Network 干净;375px 视口下 widget 不压住抽屉把手。

- [ ] **Step 7: Commit**

```bash
git add web/prototype/pages/my-home/index.html
git commit -m "feat(prototype): 我的家接入包公球——选户型thinking/成功happy/编辑器idle"
```

---

### Task 7: 画一笔 & 拍一张升级为场景页

**Files:**
- Rewrite: `web/prototype/pages/draw/index.html`
- Rewrite: `web/prototype/pages/capture/index.html`

- [ ] **Step 1: 用以下完整内容覆盖 `web/prototype/pages/draw/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DreamHome · 画一笔</title>
<link rel="stylesheet" href="./dreamhome-d-system.css" />
<link rel="stylesheet" href="../shared/five-tabbar.css" />
<link rel="stylesheet" href="../shared/mascot.css" />
<style>
body { margin: 0; min-width: 320px; background: var(--dh-bg-canvas); }
.preview-stage { min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; box-sizing: border-box; }
@media (max-width: 420px) { .preview-stage { min-height: 100svh; padding: 18px 10px; } }
.feature-content { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 14px 18px var(--dh-tabbar-safe-space); overflow-y: auto; scrollbar-width: none; }
.feature-content::-webkit-scrollbar { display: none; }
.feature-hero { position: relative; border-radius: 22px; padding: 18px 16px 20px; background:
  radial-gradient(circle at 82% 20%, rgba(255,255,255,.5), transparent 46%), linear-gradient(150deg, #eef5ed, #d9e6d3);
  border: 1px solid rgba(117,139,113,.2); box-shadow: 0 8px 22px rgba(69,89,67,.1); }
.feature-hero .eyebrow { display: inline-block; padding: 4px 8px; border-radius: 7px; background: var(--dh-color-sage-100); color: var(--dh-color-sage-800); font-size: 10px; font-weight: var(--dh-font-weight-heavy); }
.feature-hero h1 { margin: 10px 0 6px; font-size: 22px; letter-spacing: 0; }
.feature-hero p { margin: 0; max-width: 190px; color: var(--dh-fg-secondary); font-size: 12px; line-height: 1.7; }
.step-card { display: flex; gap: 11px; align-items: center; padding: 12px; border-radius: 16px; background: rgba(255,255,255,.88); border: 1px solid rgba(117,139,113,.16); box-shadow: 0 4px 12px rgba(69,89,67,.06); }
.step-num { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--dh-color-sage-600); color: #fff; font-size: 12px; font-weight: var(--dh-font-weight-heavy); }
.step-card b { display: block; font-size: 12.5px; margin-bottom: 2px; }
.step-card span { display: block; color: var(--dh-fg-secondary); font-size: 10.5px; line-height: 1.5; }
.feature-action { margin-top: auto; min-height: 44px; border: 0; border-radius: 15px; background: var(--dh-color-sage-600); color: #fff; font: inherit; font-size: 13px; font-weight: var(--dh-font-weight-bold); cursor: pointer; }
.feature-action:active { transform: scale(.98); }
</style>
</head>
<body>
<main class="preview-stage">
<section class="dh-phone-shell">
  <div class="dh-screen">
    <div class="dh-statusbar"><span>9:41</span><span class="dh-dynamic-island"></span><span class="dh-status-icons">▮◔</span></div>
    <div class="feature-content">
      <section class="feature-hero"><span class="eyebrow">SKETCH → 3D</span><h1>画一笔</h1><p>随手画个轮廓,包公球帮你补全成能摆进家里的 3D 组件。</p></section>
      <div class="step-card"><span class="step-num">1</span><div><b>手绘线稿</b><span>画布上勾出家具轮廓,不用太工整</span></div></div>
      <div class="step-card"><span class="step-num">2</span><div><b>包公球理解</b><span>识别形状与比例,推断家具类型</span></div></div>
      <div class="step-card"><span class="step-num">3</span><div><b>生成 3D 组件</b><span>产出可复用组件,自动收进灵感库</span></div></div>
      <button class="feature-action" type="button" id="featureAction">准备画布</button>
    </div>
    <nav class="dh-tabbar dh-tabbar--five" aria-label="主功能导航"><a class="dh-tab dh-tab--active" href="./index.html" aria-label="画一笔" aria-current="page"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/draw.svg" alt="" /></span></a><a class="dh-tab" href="../capture/index.html" aria-label="拍一张"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/capture.svg" alt="" /></span></a><a class="dh-tab dh-tab--core" href="../inspiration-library/index.html" aria-label="灵感库"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/inspiration.svg" alt="" /></span></a><a class="dh-tab" href="../discover/index.html" aria-label="刷一刷"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/discover.svg" alt="" /></span></a><a class="dh-tab" href="../my-home/index.html" aria-label="我的家"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/my-home.svg" alt="" /></span></a></nav>
    <div class="dh-home-indicator" aria-hidden="true"></div>
  </div>
</section>
</main>
<script type="module">
import { createMascot } from '../shared/mascot.js';
const mascot = createMascot(document.querySelector('.dh-screen'), { dock: 'bottom-right', state: 'thinking' });
document.getElementById('featureAction').addEventListener('click', () => mascot.setState('happy', { then: 'thinking' }));
</script>
</body>
</html>
```

- [ ] **Step 2: 用以下完整内容覆盖 `web/prototype/pages/capture/index.html`**

与 draw 同构,差异仅在文案、状态与 tabbar 高亮。完整文件:

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DreamHome · 拍一张</title>
<link rel="stylesheet" href="./dreamhome-d-system.css" />
<link rel="stylesheet" href="../shared/five-tabbar.css" />
<link rel="stylesheet" href="../shared/mascot.css" />
<style>
body { margin: 0; min-width: 320px; background: var(--dh-bg-canvas); }
.preview-stage { min-height: 100vh; display: grid; place-items: center; padding: 28px 18px; box-sizing: border-box; }
@media (max-width: 420px) { .preview-stage { min-height: 100svh; padding: 18px 10px; } }
.feature-content { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 14px 18px var(--dh-tabbar-safe-space); overflow-y: auto; scrollbar-width: none; }
.feature-content::-webkit-scrollbar { display: none; }
.feature-hero { position: relative; border-radius: 22px; padding: 18px 16px 20px; background:
  radial-gradient(circle at 82% 20%, rgba(255,255,255,.5), transparent 46%), linear-gradient(150deg, #eef5ed, #d9e6d3);
  border: 1px solid rgba(117,139,113,.2); box-shadow: 0 8px 22px rgba(69,89,67,.1); }
.feature-hero .eyebrow { display: inline-block; padding: 4px 8px; border-radius: 7px; background: var(--dh-color-sage-100); color: var(--dh-color-sage-800); font-size: 10px; font-weight: var(--dh-font-weight-heavy); }
.feature-hero h1 { margin: 10px 0 6px; font-size: 22px; letter-spacing: 0; }
.feature-hero p { margin: 0; max-width: 190px; color: var(--dh-fg-secondary); font-size: 12px; line-height: 1.7; }
.step-card { display: flex; gap: 11px; align-items: center; padding: 12px; border-radius: 16px; background: rgba(255,255,255,.88); border: 1px solid rgba(117,139,113,.16); box-shadow: 0 4px 12px rgba(69,89,67,.06); }
.step-num { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--dh-color-sage-600); color: #fff; font-size: 12px; font-weight: var(--dh-font-weight-heavy); }
.step-card b { display: block; font-size: 12.5px; margin-bottom: 2px; }
.step-card span { display: block; color: var(--dh-fg-secondary); font-size: 10.5px; line-height: 1.5; }
.feature-action { margin-top: auto; min-height: 44px; border: 0; border-radius: 15px; background: var(--dh-color-sage-600); color: #fff; font: inherit; font-size: 13px; font-weight: var(--dh-font-weight-bold); cursor: pointer; }
.feature-action:active { transform: scale(.98); }
</style>
</head>
<body>
<main class="preview-stage">
<section class="dh-phone-shell">
  <div class="dh-screen">
    <div class="dh-statusbar"><span>9:41</span><span class="dh-dynamic-island"></span><span class="dh-status-icons">▮◔</span></div>
    <div class="feature-content">
      <section class="feature-hero"><span class="eyebrow">PHOTO → 3D</span><h1>拍一张</h1><p>线下看到心动家具,拍下来交给包公球变成 3D 组件。</p></section>
      <div class="step-card"><span class="step-num">1</span><div><b>拍摄或选图</b><span>对准家具主体,支持相册选取</span></div></div>
      <div class="step-card"><span class="step-num">2</span><div><b>抠出主体</b><span>自动去背景,留下干净的家具</span></div></div>
      <div class="step-card"><span class="step-num">3</span><div><b>生成 3D 组件</b><span>产出可复用组件,自动收进灵感库</span></div></div>
      <button class="feature-action" type="button" id="featureAction">打开相机</button>
    </div>
    <nav class="dh-tabbar dh-tabbar--five" aria-label="主功能导航"><a class="dh-tab" href="../draw/index.html" aria-label="画一笔"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/draw.svg" alt="" /></span></a><a class="dh-tab dh-tab--active" href="./index.html" aria-label="拍一张" aria-current="page"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/capture.svg" alt="" /></span></a><a class="dh-tab dh-tab--core" href="../inspiration-library/index.html" aria-label="灵感库"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/inspiration.svg" alt="" /></span></a><a class="dh-tab" href="../discover/index.html" aria-label="刷一刷"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/discover.svg" alt="" /></span></a><a class="dh-tab" href="../my-home/index.html" aria-label="我的家"><span class="dh-tab-icon"><img src="../../assets/icons/navigation/my-home.svg" alt="" /></span></a></nav>
    <div class="dh-home-indicator" aria-hidden="true"></div>
  </div>
</section>
</main>
<script type="module">
import { createMascot } from '../shared/mascot.js';
const mascot = createMascot(document.querySelector('.dh-screen'), { dock: 'bottom-right', state: 'idle' });
document.getElementById('featureAction').addEventListener('click', () => mascot.setState('happy', { then: 'idle' }));
</script>
</body>
</html>
```

- [ ] **Step 3: 浏览器验证**

两页分别打开:hero + 三步卡 + CTA 完整显示,375px 无横向滚动;包公球状态正确(draw=thinking,capture=idle),点 CTA 它 happy 弹一下回落;tabbar 五个链接互通正常;Console/Network 干净。

- [ ] **Step 4: Commit**

```bash
git add web/prototype/pages/draw/index.html web/prototype/pages/capture/index.html
git commit -m "feat(prototype): 画一笔/拍一张升级为D风场景页并接入包公球"
```

---

### Task 8: main-interface 轻改

**Files:**
- Modify: `web/prototype/pages/main-interface/index.html`

- [ ] **Step 1: 主色向 sage 靠拢**

第 11 行 `:root` 里 `--clay: #c96d48;` 替换为:

```css
--clay: #6f8a6e;
```

第 72 行 hero SVG 里辅助笔触 `stroke="#c96d48"` 替换为 `stroke="#6f8a6e"`。

- [ ] **Step 2: 接入包公球**

head 中 `<style>` 标签之前加:

```html
  <link rel="stylesheet" href="../shared/mascot.css" />
```

`</body>` 前(第 80 行原有 `<script>` 之后)加:

```html
  <script type="module">
    import { createMascot } from '../shared/mascot.js';
    createMascot(document.querySelector('.screen'), { dock: 'bottom-right' });
  </script>
```

(该页无 tabbar,`--dh-tabbar-safe-space` 未定义,mascot.css 的 `var(--dh-tabbar-safe-space, 100px)` 兜底生效,widget 落在屏幕右下安全区。)

- [ ] **Step 3: 浏览器验证**

打开 `http://127.0.0.1:5178/prototype/pages/main-interface/index.html`:橙色点缀变 sage 绿(头像投影、入口 orb、hero 辅助笔触);右下角 idle 包公球浮动;原有入口点选交互和 toast 不回归;Console 干净(Google Fonts 为该页原有外链,保持不动)。

- [ ] **Step 4: Commit**

```bash
git add web/prototype/pages/main-interface/index.html
git commit -m "style(prototype): main-interface 主色向sage统一并接入包公球"
```

---

### Task 9: 全量走查 + 收尾

**Files:** 无新改动(发现问题则回到对应 Task 修)

- [ ] **Step 1: 六页面完整走查清单**

| 页面 | 检查点 |
|---|---|
| 刷一刷 | 圈选→投喂→打造→通知→跳灵感库全链路;连投 2 件徽标计数正确 |
| 灵感库 | NEW 资产出现且分类自动定位;点后消 NEW;空收藏 sleeping;包公球不遮 tabbar |
| 我的家 | thinking→(隐藏)→happy→idle 状态流;原 3D 编辑器无回归 |
| 画一笔/拍一张 | 场景页完整,包公球状态正确 |
| main-interface | sage 化 + 包公球,原交互无回归 |

- [ ] **Step 2: 横切检查**

1. 375px 视口跑一遍六个页面,无横向滚动、widget 无遮挡关键按钮。
2. DevTools Rendering → Emulate `prefers-reduced-motion: reduce`:浮动/敲击/Zzz 动画停用,状态图仍切换。
3. 每页 Console 零报错、Network 零 404。
4. 30s 无操作:idle 页面包公球入睡,交互唤醒。

- [ ] **Step 3: 更新原型 README 目录约定**

`web/prototype/README.md` 的「目录约定」一节,`- pages/shared/：共享导航、平台组件目录和收藏状态工具。` 替换为:

```markdown
- `pages/shared/`：共享导航、平台组件目录、收藏与已打造资产状态工具、包公球组件（`mascot.js`/`mascot.css`）。
```

- [ ] **Step 4: 提交收尾并推送**

```bash
git add web/prototype/README.md
git commit -m "docs(prototype): 目录约定补充包公球共享组件"
git push origin main   # 触发 GitHub Pages 自动重新部署 web/
```

- [ ] **Step 5: 线上验证**

等 Pages workflow 完成后抽查 `https://amb2rzhou.github.io/dreamhome-hackathon/prototype/pages/discover/index.html`:素材相对路径在 `/dreamhome-hackathon/` 前缀下无 404,投喂闭环可跑。
