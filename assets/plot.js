/* laloux.me — one set of data points that keeps rearranging itself into different charts. */
(() => {
  "use strict";

  const canvas = document.getElementById("plot");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const word = canvas.dataset.word || "laloux";
  const statusEl = document.getElementById("status");
  const countEl = document.getElementById("count");
  const figEl = document.getElementById("fig");
  const nextBtn = document.getElementById("next");
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  const touchMQ = window.matchMedia("(hover: none) and (pointer: coarse)");

  const css = getComputedStyle(document.documentElement);
  const tok = (name) => css.getPropertyValue(name).trim();
  const SERIES = [tok("--paper"), tok("--saffron"), tok("--coral")];
  const WEIGHTS = [0.56, 0.26, 0.18];
  const GRID = tok("--grid");
  const AXIS = tok("--axis");
  const MUTED = tok("--muted");
  const PAPER = tok("--paper");
  const FIELD = tok("--field");
  const DISPLAY = tok("--font-display");
  const MONO = tok("--font-mono");

  // The charts the points cycle through. `hold` is how long each one stays (ms, transition included).
  const FORMS = [
    { id: "scatter", label: "scatter plot", hold: 3600 },
    { id: "word", label: `“${word}”`, hold: 6500 },
    { id: "histogram", label: "histogram", hold: 3800 },
    { id: "series", label: "time series", hold: 3800 },
    { id: "donut", label: "donut chart", hold: 3800 },
  ];
  const WORD = 1;
  const INTRO_MS = 900;    // the opening scatter plot, before the name forms
  const SWEEP_MS = 1000;   // stagger of a transition across the plot
  const MAX_POINTS = 3200;

  const fmt = new Intl.NumberFormat("en-US");

  let W = 0, H = 0, dpr = 1;
  let pad = { l: 34, r: 8, t: 8, b: 26 };
  let pts = [];
  let targets = {};        // form id -> { pts: [{x, y}], r: dot radius }
  let formIdx = 0;
  let radius = 2;
  let trendAlpha = 0;
  let running = false;
  let settled = false;
  let pointer = null;      // {x, y} in CSS px: mouse hover or a finger on the plot
  let down = null;         // pointerdown info, to tell a tap from a drag
  let highlight = -1;
  let timer = 0;
  let intro = true;

  /* ---------- helpers ---------- */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = () => reduceMQ.matches;
  const autoCycle = () => touchMQ.matches && !reduced();

  function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickSeries() {
    const r = Math.random();
    return r < WEIGHTS[0] ? 0 : r < WEIGHTS[0] + WEIGHTS[1] ? 1 : 2;
  }

  const byX = (a, b) => a.x - b.x;
  const dotR = (pitch) => clamp(pitch * 0.34, 1.1, 3.2);

  // Trend line of the scatter plot, as a fraction of plot height from the top.
  const trend = (u) => 0.8 - 0.58 * u;

  /* ---------- layout ---------- */

  function measure() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const narrow = W < 520;
    pad = { l: narrow ? 26 : 34, r: 6, t: 8, b: narrow ? 22 : 26 };
  }

  function plotBox() {
    return { x: pad.l, y: pad.t, w: W - pad.l - pad.r, h: H - pad.t - pad.b };
  }

  // Hex grid of dots with spacing `p` inside a shape.
  function hexGrid(b, p, inside) {
    const out = [];
    const rowH = p * 0.866;
    let row = 0;
    for (let y = b.y0 + rowH / 2; y < b.y1; y += rowH, row++) {
      const shift = row % 2 ? p / 2 : 0;
      for (let x = b.x0 + p / 2 + shift; x < b.x1; x += p) {
        if (inside(x, y)) out.push({ x, y });
      }
    }
    return out;
  }

  // Exactly n dots filling a shape of roughly `area` px².
  function fillExact(inside, n, area, bounds) {
    let p = Math.sqrt(area / Math.max(1, n * 0.866)) * 1.08;
    let grid = [];
    for (let i = 0; i < 200; i++) {
      grid = hexGrid(bounds, p, inside);
      if (grid.length >= n) break;
      p *= 0.99;
    }
    grid = shuffle(grid).slice(0, n);
    while (grid.length < n && grid.length) {
      const q = grid[(Math.random() * grid.length) | 0];
      grid.push({ x: q.x + (Math.random() - 0.5) * p, y: q.y + (Math.random() - 0.5) * p });
    }
    return { pts: grid, p };
  }

  /* ---------- the charts ---------- */

  function wordForm() {
    const box = plotBox();
    const ow = Math.max(1, Math.floor(box.w));
    const oh = Math.max(1, Math.floor(box.h));
    const off = document.createElement("canvas");
    off.width = ow;
    off.height = oh;
    const o = off.getContext("2d", { willReadFrequently: true });

    o.font = `800 100px ${DISPLAY}`;
    const m100 = o.measureText(word);
    const h100 = (m100.actualBoundingBoxAscent || 72) + (m100.actualBoundingBoxDescent || 0);
    const fitW = W < 520 ? 0.96 : 0.9;
    const size = Math.min((ow * fitW) / m100.width, (oh * 0.8) / h100) * 100;

    o.font = `800 ${size}px ${DISPLAY}`;
    const m = o.measureText(word);
    const asc = m.actualBoundingBoxAscent || size * 0.72;
    const desc = m.actualBoundingBoxDescent || 0;
    o.textAlign = "center";
    o.textBaseline = "alphabetic";
    o.fillStyle = "#000";
    o.fillText(word, ow / 2, (oh - (asc + desc)) / 2 + asc);

    const data = o.getImageData(0, 0, ow, oh).data;
    let filled = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 140) filled++;
    filled *= 4;

    const step = Math.max(W < 520 ? 3.6 : 4.4, Math.sqrt(filled / MAX_POINTS) * 1.02);
    const inside = (x, y) => {
      x = x | 0; y = y | 0;
      if (x < 0 || y < 0 || x >= ow || y >= oh) return false;
      return data[(y * ow + x) * 4 + 3] > 140;
    };
    const out = hexGrid({ x0: 0, y0: 0, x1: ow, y1: oh }, step, inside).map((q) => ({
      x: box.x + q.x + (Math.random() - 0.5) * step * 0.22,
      y: box.y + q.y + (Math.random() - 0.5) * step * 0.22,
    }));
    return { pts: out.sort(byX), r: dotR(step) };
  }

  function scatterForm(n, r) {
    const box = plotBox();
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      out.push({
        x: box.x + (0.025 + 0.95 * u) * box.w,
        y: box.y + clamp(trend(u) + gauss() * 0.085, 0.03, 0.97) * box.h,
      });
    }
    return { pts: out.sort(byX), r };
  }

  function seriesForm(n, r) {
    const box = plotBox();
    const f = (u) => 0.5 - 0.2 * Math.sin(2 * Math.PI * u * 1.15 + 0.5) - 0.09 * Math.sin(2 * Math.PI * u * 3.4 + 1.2);
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = 0.02 + 0.96 * Math.random();
      out.push({
        x: box.x + u * box.w,
        y: box.y + clamp(f(u) + gauss() * 0.032, 0.03, 0.97) * box.h,
      });
    }
    return { pts: out.sort(byX), r };
  }

  function histogramForm(n) {
    const box = plotBox();
    const bins = W < 520 ? 11 : 19;
    const binW = box.w / bins;
    const g = [];
    for (let i = 0; i < bins; i++) {
      const u = (i + 0.5) / bins;
      g.push(Math.exp(-((u - 0.44) ** 2) / (2 * 0.16 ** 2)) + 0.3 * Math.exp(-((u - 0.8) ** 2) / (2 * 0.07 ** 2)));
    }
    const sum = g.reduce((a, b) => a + b, 0);
    const raw = g.map((v) => (v / sum) * n);
    const counts = raw.map(Math.floor);
    let rest = n - counts.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
      if (rest > 0) { counts[i]++; rest--; }
    });
    const most = Math.max(...counts);

    let p = Math.min(binW, box.h);
    let cols = 1;
    for (let i = 0; i < 200; i++) {
      cols = Math.max(1, Math.floor((binW * 0.8) / p));
      if (Math.ceil(most / cols) * p <= box.h * 0.88 || p < 1.5) break;
      p *= 0.97;
    }

    const out = [];
    counts.forEach((c, i) => {
      const cx = box.x + (i + 0.5) * binW;
      const x0 = cx - ((cols - 1) * p) / 2;
      for (let k = 0; k < c; k++) {
        out.push({ x: x0 + (k % cols) * p, y: box.y + box.h - p * 0.6 - Math.floor(k / cols) * p });
      }
    });
    return { pts: out.sort(byX), r: dotR(p) };
  }

  // Ring split by series, so the legend reads as the key of the donut.
  function donutForm(counts) {
    const box = plotBox();
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const R = Math.min(box.w, box.h) * 0.47;
    const r0 = R * 0.56;
    const n = counts.reduce((a, b) => a + b, 0);
    const gap = 0.05;
    const angleOf = (x, y) => {
      const a = Math.atan2(x - cx, -(y - cy));
      return a < 0 ? a + Math.PI * 2 : a;
    };
    const out = [];
    let start = 0;
    let pitch = 4;
    counts.forEach((c) => {
      const a0 = start + gap / 2;
      const a1 = start + (c / n) * Math.PI * 2 - gap / 2;
      start += (c / n) * Math.PI * 2;
      if (c <= 0) return;
      const inside = (x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r0 || d > R) return false;
        const a = angleOf(x, y);
        return a >= a0 && a <= a1;
      };
      const area = (Math.max(0.01, a1 - a0) / 2) * (R * R - r0 * r0);
      const seg = fillExact(inside, c, area, { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R });
      pitch = seg.p;
      seg.pts.sort((a, b) => angleOf(a.x, a.y) - angleOf(b.x, b.y));
      out.push(...seg.pts);
    });
    return { pts: out, r: dotR(pitch), cx, cy };
  }

  /* ---------- build + assignment ---------- */

  function build() {
    measure();
    const w = wordForm();
    const n = w.pts.length;

    if (pts.length !== n) {
      pts = w.pts.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0, tx: 0, ty: 0, s: pickSeries(), d: 0 }));
    }
    // Keep points of the same series together so the donut can be dealt out in order.
    const counts = [0, 0, 0];
    pts.forEach((p) => counts[p.s]++);

    targets = {
      word: w,
      scatter: scatterForm(n, w.r),
      series: seriesForm(n, w.r),
      histogram: histogramForm(n),
      donut: donutForm(counts),
    };

    if (countEl) countEl.textContent = fmt.format(n);
    assign(formIdx, false);
  }

  function assign(i, animate, fromDonut = false) {
    const form = FORMS[i];
    const T = targets[form.id];
    if (!T) return;
    const box = plotBox();
    const now = performance.now();

    if (form.id === "donut") {
      const groups = [[], [], []];
      pts.forEach((p) => groups[p.s].push(p));
      let k = 0;
      groups.forEach((g) => {
        g.sort(byX).forEach((p) => {
          const t = T.pts[k++];
          p.tx = t.x; p.ty = t.y;
        });
      });
    } else {
      // Out of the donut the series sit in blocks; deal the points out at random so the colors mix again.
      const order = fromDonut ? shuffle(pts.slice()) : pts.slice().sort(byX);
      order.forEach((p, k) => {
        const t = T.pts[k];
        p.tx = t.x; p.ty = t.y;
      });
    }

    pts.forEach((p) => {
      p.hx = p.x; p.hy = p.y;
      if (!animate) {
        p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0; p.d = 0;
        return;
      }
      let f;
      if (form.id === "donut") {
        const a = Math.atan2(p.tx - T.cx, -(p.ty - T.cy));
        f = (a < 0 ? a + Math.PI * 2 : a) / (Math.PI * 2);
      } else {
        f = (p.tx - box.x) / box.w;
      }
      p.d = now + f * SWEEP_MS + Math.random() * 220;
    });

    if (!animate) {
      radius = T.r;
      trendAlpha = form.id === "scatter" ? 1 : 0;
    }
    settled = !animate;
    caption();
    if (animate) kick();
    else draw();
  }

  function goTo(i) {
    const fromDonut = FORMS[formIdx].id === "donut";
    formIdx = (i + FORMS.length) % FORMS.length;
    assign(formIdx, !reduced(), fromDonut);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (reduced()) return;
    if (!autoCycle() && !(intro && formIdx === 0)) return;
    const wait = intro && formIdx === 0 ? INTRO_MS : FORMS[formIdx].hold;
    const fire = () => {
      if (document.hidden) { timer = setTimeout(fire, 800); return; }
      intro = false;
      goTo(formIdx + 1);
    };
    timer = setTimeout(fire, wait);
  }

  function caption() {
    const form = FORMS[formIdx];
    if (figEl) figEl.textContent = `Fig. ${formIdx + 1}`;
    if (statusEl) {
      statusEl.textContent = form.label;
      statusEl.dataset.phase = settled ? "settled" : "moving";
    }
  }

  /* ---------- simulation ---------- */

  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function tick(now) {
    let moving = false;
    const R = 70;
    const push = pointer && !reduced();
    const form = FORMS[formIdx];
    const T = targets[form.id];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const go = now >= p.d;
      const gx = go ? p.tx : p.hx;
      const gy = go ? p.ty : p.hy;

      p.vx = (p.vx + (gx - p.x) * 0.055) * 0.83;
      p.vy = (p.vy + (gy - p.y) * 0.055) * 0.83;

      if (push) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = (1 - d / R) * (1 - d / R) * 5.5;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }

      p.x += p.vx;
      p.y += p.vy;

      if (!go || Math.abs(p.vx) + Math.abs(p.vy) > 0.03 || Math.abs(gx - p.x) + Math.abs(gy - p.y) > 0.25) {
        moving = true;
      } else {
        p.x = gx; p.y = gy; p.vx = 0; p.vy = 0;
      }
    }

    const rTarget = T ? T.r : radius;
    radius += (rTarget - radius) * 0.12;
    const tTarget = form.id === "scatter" ? 1 : 0;
    trendAlpha += (tTarget - trendAlpha) * 0.08;
    if (Math.abs(rTarget - radius) > 0.01 || Math.abs(tTarget - trendAlpha) > 0.01) moving = true;
    else { radius = rTarget; trendAlpha = tTarget; }

    draw();

    if (moving) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      if (!settled) { settled = true; caption(); }
    }
  }

  /* ---------- drawing ---------- */

  function draw() {
    const box = plotBox();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // grid + tick labels (data units 0–100 on both axes)
    const narrow = W < 520;
    const xStep = narrow ? 25 : 10;
    ctx.lineWidth = 1;
    ctx.font = `400 ${narrow ? 9 : 10}px ${MONO}`;
    ctx.fillStyle = MUTED;

    ctx.strokeStyle = GRID;
    ctx.beginPath();
    for (let v = 0; v <= 100; v += 20) {
      const y = Math.round(box.y + box.h * (1 - v / 100)) + 0.5;
      ctx.moveTo(box.x, y);
      ctx.lineTo(box.x + box.w, y);
    }
    for (let v = 0; v <= 100; v += xStep) {
      const x = Math.round(box.x + box.w * (v / 100)) + 0.5;
      ctx.moveTo(x, box.y);
      ctx.lineTo(x, box.y + box.h);
    }
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let v = 0; v <= 100; v += 20) {
      ctx.fillText(String(v), box.x - 7, box.y + box.h * (1 - v / 100));
    }
    ctx.textBaseline = "top";
    for (let v = 0; v <= 100; v += xStep) {
      const x = box.x + box.w * (v / 100);
      ctx.textAlign = v === 0 ? "left" : v === 100 ? "right" : "center";
      ctx.fillText(String(v), x, box.y + box.h + 8);
    }

    // axes
    ctx.strokeStyle = AXIS;
    ctx.beginPath();
    ctx.moveTo(box.x + 0.5, box.y);
    ctx.lineTo(box.x + 0.5, box.y + box.h + 0.5);
    ctx.lineTo(box.x + box.w, box.y + box.h + 0.5);
    ctx.stroke();

    // points, one path per series
    const r = radius;
    for (let s = 0; s < 3; s++) {
      ctx.globalAlpha = highlight < 0 || highlight === s ? 1 : 0.16;
      ctx.fillStyle = SERIES[s];
      ctx.beginPath();
      const rr = highlight === s ? r * 1.25 : r;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.s !== s) continue;
        if (s === 0) {
          ctx.moveTo(p.x + rr, p.y);
          ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        } else if (s === 1) {
          const q = rr * 0.9;
          ctx.rect(p.x - q, p.y - q, q * 2, q * 2);
        } else {
          const q = rr * 1.15;
          ctx.moveTo(p.x, p.y - q);
          ctx.lineTo(p.x + q, p.y + q * 0.75);
          ctx.lineTo(p.x - q, p.y + q * 0.75);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // fitted trend line, shown with the scatter plot
    if (trendAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = trendAlpha * 0.8;
      ctx.strokeStyle = PAPER;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(box.x + 0.02 * box.w, box.y + trend(0) * box.h);
      ctx.lineTo(box.x + 0.98 * box.w, box.y + trend(1) * box.h);
      ctx.stroke();
      ctx.restore();
    }

    if (pointer) drawCrosshair(box);
  }

  function drawCrosshair(box) {
    const { x, y } = pointer;
    if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return;

    ctx.save();
    ctx.strokeStyle = PAPER;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, box.y);
    ctx.lineTo(Math.round(x) + 0.5, box.y + box.h);
    ctx.moveTo(box.x, Math.round(y) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();

    const vx = ((x - box.x) / box.w) * 100;
    const vy = (1 - (y - box.y) / box.h) * 100;
    tag(vx.toFixed(1), x, box.y + box.h + 4, "x");
    tag(vy.toFixed(1), box.x - 4, y, "y");
  }

  function tag(text, x, y, axis) {
    ctx.font = `500 10px ${MONO}`;
    const w = ctx.measureText(text).width + 10;
    const h = 17;
    let rx, ry;
    if (axis === "x") { rx = clamp(x - w / 2, 0, W - w); ry = y; }
    else { rx = Math.max(0, x - w); ry = y - h / 2; }
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx, ry, w, h, 3);
    else ctx.rect(rx, ry, w, h);
    ctx.fill();
    ctx.fillStyle = FIELD;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rx + w / 2, ry + h / 2 + 0.5);
  }

  /* ---------- input ---------- */

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function refresh() {
    if (running) return;
    if (reduced()) draw();
    else kick();
  }

  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    if (e.pointerType !== "mouse") {
      pointer = localPoint(e);
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      refresh();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" && !down) return;
    pointer = localPoint(e);
    refresh();
  });

  function release(e, cancelled) {
    const d = down;
    down = null;
    if (e.pointerType !== "mouse") {
      pointer = null;
      if (!running) draw();
    }
    if (cancelled || !d || d.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved < 10 && performance.now() - d.t < 450) {
      intro = false;
      goTo(formIdx + 1);
    }
  }

  canvas.addEventListener("pointerup", (e) => release(e, false));
  canvas.addEventListener("pointercancel", (e) => release(e, true));
  canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    pointer = null;
    if (!running) draw();
  });

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      intro = false;
      goTo(formIdx + 1);
    });
  }

  document.querySelectorAll("[data-series]").forEach((el) => {
    const s = Number(el.dataset.series);
    const on = () => { highlight = s; if (!running) draw(); };
    const off = () => { highlight = -1; if (!running) draw(); };
    el.addEventListener("pointerenter", on);
    el.addEventListener("pointerleave", off);
    el.addEventListener("focus", on);
    el.addEventListener("blur", off);
  });

  const onPrefChange = () => schedule();
  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener("change", onPrefChange);
    touchMQ.addEventListener("change", onPrefChange);
  }

  /* ---------- boot ---------- */

  let lastW = 0, lastH = 0, resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(rect.width - lastW) < 2 && Math.abs(rect.height - lastH) < 2) return;
    lastW = rect.width; lastH = rect.height;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 140);
  });

  const fontReady = document.fonts && document.fonts.load
    ? Promise.race([
        document.fonts.load(`800 100px ${DISPLAY}`, word),
        new Promise((res) => setTimeout(res, 2500)),
      ])
    : Promise.resolve();

  fontReady.catch(() => {}).then(() => {
    const rect = canvas.getBoundingClientRect();
    lastW = rect.width; lastH = rect.height;
    if (reduced()) { formIdx = WORD; intro = false; }
    build();
    schedule();
    ro.observe(canvas);
  });
})();
