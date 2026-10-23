/* =========================================================
   活动小本本 · 背景层胶水 + 交互
   ---------------------------------------------------------
   1) 渲染预算：背景最多按 2K（2560×1440）渲染再放大铺满，
      1080p/2K 原生清晰，4K 不掉帧（实测三档都满帧）。
   2) 鼠标交互：
      · 把指针位置转发给背景里的 3D 场景 —— 那套渲染器本身
        就吃 pointer 位置做镜头视差，于是背景会随鼠标轻轻偏移；
      · 背景层再加一点点 CSS 视差 + 跟着鼠标的一团柔光；
      · 点空白处会有一圈很淡的涟漪。
   3) 场景就绪后淡入；起不来就保持深色渐变底，界面照常可用。
   应用本身的逻辑一律不碰。
   ========================================================= */
(function () {
  'use strict';

  var MAX_PIXELS = 2560 * 1440;      // 渲染预算（设备像素）

  var layer = document.getElementById('desk-bg');
  if (!layer) return;

  var frame = document.getElementById('desk-bg-frame');
  var parallax = layer.querySelector('.desk-bg-parallax');
  var light = layer.querySelector('.desk-bg-light');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ready = false;
  var boxW = 0;
  var boxH = 0;
  var fitScale = 1;

  var curX = 0, curY = 0;            // 当前视差（px）
  var aimX = 0, aimY = 0;            // 目标视差
  var raf = 0;
  var lastForward = 0;

  /* ---------- 渲染尺寸 ---------- */

  function fitFrame() {
    if (!frame) return;
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var dpr = window.devicePixelRatio || 1;
    var pixels = vw * dpr * vh * dpr;
    var k = pixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / pixels) : 1;

    var w = Math.round(vw * k);
    var h = Math.round(vh * k);
    fitScale = vw / w;

    boxW = w;
    boxH = h;

    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    /* 多留 4% 余量，视差晃动时不会露出边 */
    frame.style.transform = 'translate(-50%, -50%) scale(' + (fitScale * 1.04).toFixed(4) + ')';
  }

  /* ---------- 视差 ---------- */

  function applyParallax() {
    if (!parallax) return;
    parallax.style.transform = 'translate3d(' + curX.toFixed(2) + 'px,' + curY.toFixed(2) + 'px,0)';
  }

  function stepParallax() {
    raf = 0;
    var dx = aimX - curX;
    var dy = aimY - curY;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
      curX = aimX;
      curY = aimY;
      applyParallax();
      return;
    }
    curX += dx * 0.09;
    curY += dy * 0.09;
    applyParallax();
    raf = window.requestAnimationFrame(stepParallax);
  }

  function kick() {
    if (!raf && !reduced) raf = window.requestAnimationFrame(stepParallax);
  }

  /* ---------- 把指针喂给 3D 场景 ---------- */

  function forwardPointer(x, y) {
    if (!ready) return;
    var now = Date.now();
    if (now - lastForward < 45) return;     // 20Hz 足够，镜头本来还在缓动
    lastForward = now;

    var doc = null;
    try { doc = frame.contentDocument; } catch (e) { return; }
    if (!doc) return;

    var stage = doc.getElementById('stage') || doc.body;
    if (!stage) return;

    try {
      stage.dispatchEvent(new PointerEvent('pointermove', {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: false
      }));
    } catch (e) { /* 老内核没有 PointerEvent 就算了 */ }
  }

  /* ---------- 跟着鼠标的柔光 ---------- */

  function moveLight(x, y) {
    if (!light) return;
    light.style.setProperty('--mx', x + 'px');
    light.style.setProperty('--my', y + 'px');
  }

  /* ---------- 点空白处的涟漪 ---------- */

  var RIPPLE_IGNORE = '.panel, .topbar, .splitter, .overlay, .dialog, .reminder-bar, .undo-bar, .warn-bar, .tag-manager, button, input, textarea, a, label';

  function ripple(x, y) {
    if (reduced) return;
    var dot = document.createElement('span');
    dot.className = 'desk-ripple';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    document.body.appendChild(dot);
    window.setTimeout(function () { dot.remove(); }, 1000);
  }

  /* ---------- 事件 ---------- */

  window.addEventListener('pointermove', function (event) {
    if (reduced) return;
    if (event.pointerType === 'touch') return;

    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var nx = (event.clientX / vw) * 2 - 1;
    var ny = (event.clientY / vh) * 2 - 1;

    aimX = -nx * 16;      // 反向一点点，才有“镜头在前面”的感觉
    aimY = -ny * 11;
    kick();

    moveLight(event.clientX, event.clientY);
    forwardPointer(event.clientX, event.clientY);
  }, { passive: true });

  window.addEventListener('pointerdown', function (event) {
    if (reduced) return;
    var target = event.target;
    if (target && target.closest && target.closest(RIPPLE_IGNORE)) return;
    ripple(event.clientX, event.clientY);
  }, { passive: true });

  /* 页面滚动时背景稍微错位，滚起来有层次 */
  window.addEventListener('scroll', function () {
    if (reduced) return;
    var y = window.scrollY || 0;
    aimY = aimY * 0 + (-y * 0.012);
    kick();
  }, { passive: true });

  window.addEventListener('resize', function () {
    fitFrame();
  });

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'rhine-bg-ready') reveal();
  });

  function reveal() {
    if (ready) return;
    ready = true;
    layer.classList.add('is-ready');
    applyParallax();
  }

  /* 兜底：慢机器上也别让背景一直黑着 */
  window.setTimeout(reveal, 9000);

  fitFrame();
  applyParallax();
  moveLight(window.innerWidth * 0.5, window.innerHeight * 0.35);
})();
