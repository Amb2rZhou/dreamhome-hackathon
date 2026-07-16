// 包公球共享组件。宿主元素需 position:relative(各页 .dh-screen / .screen 均满足)。
const STATE_NAMES = ['initial', 'idle', 'thinking', 'working', 'happy', 'sleeping'];
const HAPPY_MS = 1200, SLEEP_MS = 30000, NOTICE_MS = 6000, NOTICE_FADE_MS = 300; // NOTICE_FADE_MS 须与 mascot.css .mascot-notice 的 transition .3s 一致
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

  function setState(state, { then } = {}) {
    if (!STATE_NAMES.includes(state)) { console.warn(`[mascot] unknown state: ${state}`); return; }
    clearTimeout(happyTimer);
    widget.dataset.state = state;
    face.src = stateUrl(state);
    face.classList.remove('mascot-pop');
    void face.offsetWidth; /* 强制 reflow,重启弹跳动画 */
    face.classList.add('mascot-pop');
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
      if (position !== 'right' && position !== 'bottom-right') { console.warn(`[mascot] unknown dock: ${position}`); return; }
      widget.dataset.dock = position;
    },
    show() { widget.hidden = false; },
    hide() {
      widget.hidden = true;
      dismiss();
      clearTimeout(happyTimer);
      clearTimeout(sleepTimer);
    },
    destroy() {
      WAKE_EVENT_TYPES.forEach((type) =>
        document.removeEventListener(type, wake, { capture: true }));
      clearTimeout(happyTimer);
      clearTimeout(sleepTimer);
      clearTimeout(noticeTimer);
      widget.remove();
      notice.remove();
    },
  };
}
