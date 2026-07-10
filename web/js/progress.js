// 生成等待过程动画：四步（理解画面→3D结构→材质→打包），每步 ~6s 自动推进，
// 完成时全点亮。附计时器。让 ~20s 的等待体感是「在建模」而不是「在卡住」。
const DEFAULT_STEPS = ['理解画面', '重建 3D 结构', '生成材质贴图', '打包组件'];

export function showProgress(steps = DEFAULT_STEPS, stepMs = 6000) {
  const root = document.getElementById('progressRoot');
  root.innerHTML = '';

  const overlay = document.createElement('div');
  overlay.className = 'progress-overlay';
  overlay.innerHTML = `
    <div class="progress-card">
      <div class="progress-timer">0.0s</div>
      <div class="progress-caption">正在摘抄这件家具…</div>
      <div class="steps">
        ${steps.map((s, i) => `
          <div class="step" data-i="${i}">
            <div class="step-dot">${i + 1}</div>
            <div class="step-label">${s}</div>
          </div>`).join('')}
      </div>
    </div>`;
  root.appendChild(overlay);

  const timerEl = overlay.querySelector('.progress-timer');
  const stepEls = [...overlay.querySelectorAll('.step')];
  const start = performance.now();
  let cur = -1;

  const setActive = (i) => {
    stepEls.forEach((el, j) => {
      el.classList.toggle('done', j < i);
      el.classList.toggle('active', j === i);
      if (j < i) el.querySelector('.step-dot').textContent = '✓';
    });
  };
  const advance = () => {
    if (cur < steps.length - 1) { cur += 1; setActive(cur); }
  };
  advance(); // 立即激活第一步

  const tick = setInterval(() => {
    timerEl.textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
  }, 100);
  // 推进到倒数第二步为止；最后一步（打包）留给真实结果点亮
  const stepper = setInterval(() => {
    if (cur < steps.length - 2) advance();
    else clearInterval(stepper);
  }, stepMs);

  const cleanup = () => { clearInterval(tick); clearInterval(stepper); };

  return {
    setCaption(t) { overlay.querySelector('.progress-caption').textContent = t; },
    // 成功：全部点亮，短暂停留后移除
    done() {
      cleanup();
      cur = steps.length; setActive(cur);
      const secs = ((performance.now() - start) / 1000).toFixed(1);
      overlay.querySelector('.progress-caption').textContent = `完成 · 用时 ${secs}s`;
      timerEl.textContent = secs + 's';
      setTimeout(() => overlay.remove(), 850);
    },
    // 失败：直接移除
    fail() { cleanup(); overlay.remove(); },
  };
}
