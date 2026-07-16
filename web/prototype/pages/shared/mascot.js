// 包公球共享组件。宿主元素需 position:relative(各页 .dh-screen / .screen 均满足)。
const STATE_NAMES = ['initial', 'idle', 'thinking', 'working', 'happy', 'sleeping'];
const HAPPY_MS = 1200, SLEEP_MS = 30000, NOTICE_MS = 6000, NOTICE_FADE_MS = 300; // NOTICE_FADE_MS 须与 mascot.css .mascot-notice 的 transition .3s 一致
const stateUrl = (state) => new URL(`../../assets/mascot/states/mascot-${state}.png`, import.meta.url).href;
// 姿态帧循环:利用同角色不同姿态图做二帧卡通动画,让本体(手/脸)动起来,而不只是整图位移
// initial 与 idle 是同一站姿(睁眼/闭眼吐泡泡),硬切即"眨眼打瞌睡";happy↔initial 即"挥手蹦跳"
const FRAME_LOOPS = {
  idle: [['initial', 2400], ['idle', 1300]],
  thinking: [['thinking', 2000], ['initial', 900]],
  happy: [['happy', 450], ['initial', 350]],
};
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  host.append(widget, notice);

  STATE_NAMES.forEach((state) => { new Image().src = stateUrl(state); });

  const face = widget.querySelector('.mascot-face');
  const badge = widget.querySelector('.mascot-badge');
  let happyTimer = null;
  let sleepTimer = null;
  let noticeTimer = null;
  let onNoticeTap = null;
  let frameTimer = null;

  function playFrames(loop, index = 0) {
    const [pose, holdMs] = loop[index % loop.length];
    face.src = stateUrl(pose);
    frameTimer = setTimeout(() => playFrames(loop, index + 1), holdMs);
  }

  function setState(state, { then } = {}) {
    if (!STATE_NAMES.includes(state)) { console.warn(`[mascot] unknown state: ${state}`); return; }
    clearTimeout(happyTimer);
    clearTimeout(frameTimer);
    widget.dataset.state = '';
    void face.offsetWidth; /* 强制 reflow,同状态重复设置(如连续投喂的 happy)也能重启动画 */
    widget.dataset.state = state;
    face.src = stateUrl(state);
    if (FRAME_LOOPS[state] && !REDUCED_MOTION) playFrames(FRAME_LOOPS[state]);
    if (state === 'happy' && then) {
      if (STATE_NAMES.includes(then)) happyTimer = setTimeout(() => setState(then), HAPPY_MS);
      else console.warn(`[mascot] unknown state: ${then}`);
    }
    if (state === 'idle') armSleep(); else clearTimeout(sleepTimer);
  }
  function armSleep() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => { if (widget.dataset.state === 'idle') setState('sleeping'); }, SLEEP_MS);
  }
  function wake() {
    if (widget.dataset.state === 'sleeping') setState('idle');
    else if (widget.dataset.state === 'idle') armSleep();
  }
  const WAKE_EVENT_TYPES = ['pointerdown', 'keydown', 'scroll'];
  WAKE_EVENT_TYPES.forEach((type) =>
    document.addEventListener(type, wake, { passive: true, capture: true }));

  function queue(count) {
    count = Number(count) || 0;
    badge.hidden = count <= 0;
    badge.textContent = count;
    badge.setAttribute('aria-label', `待处理 ${count} 件`);
  }
  function dismiss() {
    notice.classList.remove('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, NOTICE_FADE_MS);
  }
  function notify({ title, onTap, duration = NOTICE_MS } = {}) {
    notice.innerHTML = `<img src="${stateUrl('happy')}" alt="" /><b></b>`;
    notice.querySelector('b').textContent = title ?? '';
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
    dock(position) {
      if (position !== 'right' && position !== 'bottom-right' && position !== 'inline') { console.warn(`[mascot] unknown dock: ${position}`); return; }
      widget.dataset.dock = position;
    },
    show() {
      widget.hidden = false;
      clearTimeout(frameTimer);
      if (FRAME_LOOPS[widget.dataset.state] && !REDUCED_MOTION) playFrames(FRAME_LOOPS[widget.dataset.state]);
    },
    hide() {
      widget.hidden = true;
      dismiss();
      clearTimeout(happyTimer);
      clearTimeout(sleepTimer);
      clearTimeout(frameTimer);
    },
    destroy() {
      WAKE_EVENT_TYPES.forEach((type) =>
        document.removeEventListener(type, wake, { capture: true }));
      clearTimeout(happyTimer);
      clearTimeout(sleepTimer);
      clearTimeout(noticeTimer);
      clearTimeout(frameTimer);
      widget.remove();
      notice.remove();
    },
  };
}
