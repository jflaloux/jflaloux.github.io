/* laloux.me — a scatter plot whose points sort themselves into a word. */
(() => {
  "use strict";

  const canvas = document.getElementById("plot");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const word = canvas.dataset.word || "laloux";
  const statusEl = document.getElementById("status");
  const countEl = document.getElementById("count");
  const replayBtn = document.getElementById("replay");
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");

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

  const HOLD_MS = 900;     // time the raw scatter is shown before sorting
  const SWEEP_MS = 1100;   // left-to-right stagger of the sort
  const MAX_POINTS = 3200;

  const fmt = new Intl.NumberFormat("en-US");

  let W = 0, H = 0, dpr = 1;
  let pad = { l: 34, r: 8, t: 8, b: 26 };
  let pts = [];
  let t0 = 0;
  let running = false;
  let phase = "";
  let pointer = null;      // {x, y} in CSS px, mouse only
  let highlight = -1;
  let radius = 2;

  /* ---------- helpers ---------- */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = () => reduceMQ.matches;

  function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function pickSeries() {
    const r = Math.random();
    return r < WEIGHTS[0] ? 0 : r < WEIGHTS[0] + WEIGHTS[1] ? 1 : 2;
  }

  // Trend line of the "raw" dataset, as a fraction of plot height from the top.
  const trend = (u) => 0.8 - 0.58 * u;

  function setPhase(p) {
    if (p === phase) return;
    phase = p;
    if (statusEl) {
      statusEl.dataset.phase = p;
      statusEl.textContent = p;
    }
  }

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

  function sampleTargets() {
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
    const inside = (x, y) => {
      x = x | 0; y = y | 0;
      if (x < 0 || y < 0 || x >= ow || y >= oh) return false;
      return data[(y * ow + x) * 4 + 3] > 140;
    };

    let filled = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 140) filled++;
    filled *= 4;

    const step = Math.max(W < 520 ? 3.6 : 4.4, Math.sqrt(filled / MAX_POINTS) * 1.02);
    const rowH = step * 0.866;
    const out = [];
    let row = 0;
    for (let y = rowH / 2; y < oh; y += rowH, row++) {
      const shift = row % 2 ? step / 2 : 0;
      for (let x = step / 2 + shift; x < ow; x += step) {
        if (inside(x, y)) {
          out.push({
            x: box.x + x + (Math.random() - 0.5) * step * 0.22,
            y: box.y + y + (Math.random() - 0.5) * step * 0.22,
          });
        }
      }
    }
    radius = clamp(step * 0.34, 1.2, 3.2);
    return out;
  }

  function rawPosition() {
    const box = plotBox();
    const u = Math.random();
    return {
      x: box.x + (0.025 + 0.95 * u) * box.w,
      y: box.y + clamp(trend(u) + gauss() * 0.085, 0.03, 0.97) * box.h,
    };
  }

  function build(animate) {
    measure();
    const targets = sampleTargets().sort((a, b) => a.x - b.x);
    const starts = targets.map(rawPosition).sort((a, b) => a.x - b.x);
    const box = plotBox();

    pts = targets.map((t, i) => ({
      sx: starts[i].x, sy: starts[i].y,
      tx: t.x, ty: t.y,
      x: animate ? starts[i].x : t.x,
      y: animate ? starts[i].y : t.y,
      vx: 0, vy: 0,
      s: pickSeries(),
      d: HOLD_MS + ((t.x - box.x) / box.w) * SWEEP_MS + Math.random() * 240,
    }));

    if (countEl) countEl.textContent = fmt.format(pts.length);
    t0 = performance.now();
    if (animate) {
      setPhase("unsorted");
      kick();
    } else {
      pts.forEach((p) => (p.d = -1));
      setPhase("sorted");
      draw(performance.now());
    }
  }

  function replay() {
    if (!pts.length) return;
    const box = plotBox();
    const fresh = pts.map(rawPosition).sort((a, b) => a.x - b.x);
    // Keep the x-order pairing so points travel mostly vertically, like a column sort.
    pts.sort((a, b) => a.tx - b.tx);
    pts.forEach((p, i) => {
      p.sx = fresh[i].x; p.sy = fresh[i].y;
      p.d = HOLD_MS + ((p.tx - box.x) / box.w) * SWEEP_MS + Math.random() * 240;
    });
    t0 = performance.now();
    setPhase("unsorted");
    kick();
  }

  /* ---------- simulation ---------- */

  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function tick(now) {
    const t = now - t0;
    let moving = false;
    let started = 0;
    const R = 70;
    const still = reduced();

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const go = t >= p.d;
      if (go) started++;
      const gx = go ? p.tx : p.sx;
      const gy = go ? p.ty : p.sy;

      p.vx = (p.vx + (gx - p.x) * 0.055) * 0.83;
      p.vy = (p.vy + (gy - p.y) * 0.055) * 0.83;

      if (pointer && !still) {
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

    if (started === 0) setPhase("unsorted");
    else if (moving) setPhase("sorting");

    const progress = pts.length ? started / pts.length : 1;
    draw(now, 1 - clamp(progress * 1.6, 0, 1));

    if (moving) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      setPhase("sorted");
    }
  }

  /* ---------- drawing ---------- */

  function draw(now, trendAlpha = 0) {
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
    ctx.textAlign = "center";
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

    // fitted trend line of the raw data, fading as the sort begins
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

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    pointer = localPoint(e);
    if (running) return;
    if (reduced()) draw(performance.now());
    else kick();
  });

  canvas.addEventListener("pointerleave", () => {
    pointer = null;
    if (!running) draw(performance.now());
  });

  // Touch: a tap sends a ripple through the points.
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || reduced()) return;
    const p0 = localPoint(e);
    const R = 90;
    for (const p of pts) {
      const dx = p.x - p0.x, dy = p.y - p0.y;
      const d = Math.hypot(dx, dy);
      if (d < R && d > 0.01) {
        const f = (1 - d / R) * 14;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
    }
    kick();
  });

  if (replayBtn) {
    replayBtn.hidden = reduced();
    replayBtn.addEventListener("click", replay);
  }

  document.querySelectorAll("[data-series]").forEach((el) => {
    const s = Number(el.dataset.series);
    const on = () => { highlight = s; if (!running) draw(performance.now()); };
    const off = () => { highlight = -1; if (!running) draw(performance.now()); };
    el.addEventListener("pointerenter", on);
    el.addEventListener("pointerleave", off);
    el.addEventListener("focus", on);
    el.addEventListener("blur", off);
  });

  reduceMQ.addEventListener?.("change", () => {
    if (replayBtn) replayBtn.hidden = reduced();
  });

  /* ---------- boot ---------- */

  let lastW = 0, lastH = 0, resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(rect.width - lastW) < 2 && Math.abs(rect.height - lastH) < 2) return;
    lastW = rect.width; lastH = rect.height;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => build(false), 140);
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
    build(!reduced());
    ro.observe(canvas);
  });
})();
