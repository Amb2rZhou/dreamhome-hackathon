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
