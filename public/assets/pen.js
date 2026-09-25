// The nib, writing — a port of the desktop app's handwriting
// (ui/workspace/handwriting.py). The letters are the Hershey script: real pen
// strokes, in the order a hand makes them (public domain, see HERSHEY.txt).
// Each stroke is smoothed and drawn at a human pace — quicker on straight
// runs, slower through curves, a lift between strokes, a breath between words
// — with broad-nib contrast and ink that lands glossy before it dries. The nib
// rides the pen point the whole time.
(function () {
  "use strict";

  const CAP = 21;                       // Hershey units, capital top to baseline
  const NIB_EDGE = (40 * Math.PI) / 180;
  const SPEED = 150;                    // units per second: a relaxed, legible hand
  const LIFT = 0.07;
  const WORD_GAP = 0.12;
  const NIB_ANGLE = (-38 * Math.PI) / 180;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let fontPromise = null;
  function font() {
    if (!fontPromise) {
      fontPromise = fetch("/assets/hershey-script.json")
        .then((r) => (r.ok ? r.json() : { glyphs: {} }))
        .catch(() => ({ glyphs: {} }));
    }
    return fontPromise;
  }

  // a small seeded random, so a phrase is always written the same way
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function smooth(points, steps = 4) {
    if (points.length < 3) return points;
    const out = [];
    const pts = [points[0], ...points, points[points.length - 1]];
    for (let i = 1; i < pts.length - 2; i++) {
      const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /** One line laid out and timed: segments [x0, y0, x1, y1, tStart, tEnd]. */
  function layout(glyphs, text, t0 = 0) {
    const rnd = random(hash(text));
    const segs = [];
    let penX = 0, t = t0, minY = -CAP, maxY = 9;
    for (const ch of text) {
      const g = glyphs[ch] || glyphs["?"];
      if (!g) continue;
      if (ch === " ") t += WORD_GAP;
      const ox = penX - g.l;
      const jy = (rnd() - 0.5) * 0.7;
      for (const stroke of g.s) {
        const pts = smooth(stroke.map(([x, y]) => [x + ox, y + jy]));
        t += LIFT;
        let prev = null;
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
          const d = Math.hypot(x1 - x0, y1 - y0);
          if (d <= 1e-6) continue;
          const ang = Math.atan2(y1 - y0, x1 - x0);
          let turn = 0;
          if (prev !== null) turn = Math.abs(((ang - prev + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) / Math.PI;
          prev = ang;
          const dt = (d / SPEED) * (1 + 1.4 * turn);
          segs.push([x0, y0, x1, y1, t, t + dt]);
          t += dt;
          minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
        }
      }
      penX += g.w;
    }
    return { segs, end: t, width: penX, top: minY, bottom: maxY };
  }

  // the nib, in unit coordinates with the tip at the origin
  const NIB = new Path2D("M0 0C.07 .13 .2 .3 .19 .46L.13 .68H-.13L-.19 .46C-.2 .3-.07 .13 0 0Z" +
                         "M.045 .45A.045 .045 0 1 0-.045 .45A.045 .045 0 1 0 .045 .45Z" +
                         "M-.011 .08H.011V.405H-.011Z");
  const BAND = new Path2D("M-.1518 .6H.1518L.13 .68H-.13Z");

  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function rgb(color) {
    const c = document.createElement("canvas").getContext("2d");
    c.fillStyle = color;
    const hex = c.fillStyle;
    if (hex.startsWith("#")) return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const m = hex.match(/\d+/g) || [0, 0, 0];
    return m.slice(0, 3).map(Number);
  }

  class Writer {
    /**
     * canvas: where to write. opts: { cap (px), lineGap, align ("center" |
     * "left"), nib (px), speed (x), ink, wet, maxWidth }
     */
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.opts = Object.assign({ cap: 60, lineGap: 1.25, align: "center", nib: null, speed: 1, pad: 0.5 }, opts);
      this.run = 0;
      this.alpha = 1;
    }

    colours() {
      this.ink = rgb(this.opts.ink || css("--ink", "#0d0d0c"));
      this.wet = rgb(this.opts.wet || css("--accent", "#e7a54f"));
      this.nibFill = css("--nib", "#e7a54f");
      this.collar = css("--collar", "#7a2f14");
    }

    async prepare(text) {
      const { glyphs } = await font();
      const lines = String(text).split("\n");
      let t = 0;
      this.lines = lines.map((line, i) => {
        const l = layout(glyphs, line, t + (i ? 0.25 : 0));
        t = l.end;
        return l;
      });
      this.duration = t;
      this.fit();
      this.colours();
    }

    fit() {
      const o = this.opts;
      const box = this.canvas.parentElement.getBoundingClientRect();
      const avail = Math.max(120, Math.min(o.maxWidth || Infinity, box.width || this.canvas.clientWidth || 600));
      const widest = Math.max(...this.lines.map((l) => l.width), 1);
      let scale = o.cap / CAP;
      const need = widest * scale + 2 * o.cap * o.pad;
      if (need > avail) scale *= avail / need;
      this.scale = scale;
      const lineH = (CAP + 12) * scale * o.lineGap;
      const top = Math.min(...this.lines.map((l) => l.top));
      const bottom = Math.max(...this.lines.map((l) => l.bottom));
      const nib = o.nib || scale * 22;
      this.nibSize = nib;
      // The nib hangs below and to the right of the pen point, so its room is
      // at the bottom; the top only needs the tallest letter.
      this.padTop = Math.max(-top * scale, CAP * scale) + 4;
      const h = this.padTop + (this.lines.length - 1) * lineH + Math.max(bottom * scale, nib * 0.85) + 6;
      this.lineH = lineH;
      this.cssW = avail;
      this.cssH = Math.ceil(h);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(avail * dpr);
      this.canvas.height = Math.round(this.cssH * dpr);
      this.canvas.style.width = avail + "px";
      this.canvas.style.height = this.cssH + "px";
      this.dpr = dpr;
    }

    origin(i) {
      const l = this.lines[i];
      const w = l.width * this.scale;
      const x = this.opts.align === "left" ? this.opts.cap * this.opts.pad * 0.3 : (this.cssW - w) / 2;
      return [x, this.padTop + i * this.lineH];
    }

    draw(t, showNib) {
      const { ctx, dpr, scale } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.lineCap = "round";
      const base = Math.max(0.9, scale * 1.55) * (this.opts.weight || 1);
      let tip = null, down = false;
      this.lines.forEach((line, i) => {
        const [ox, oy] = this.origin(i);
        for (const [x0, y0, x1, y1, a, b] of line.segs) {
          if (a > t) {
            if (!tip) { tip = [ox + x0 * scale, oy + (y0 - 2.5) * scale]; down = false; }
            break;
          }
          const f = t >= b ? 1 : (t - a) / (b - a);
          const ex = x0 + (x1 - x0) * f, ey = y0 + (y1 - y0) * f;
          const ang = Math.atan2(y1 - y0, x1 - x0);
          ctx.lineWidth = base * (0.45 + 0.75 * Math.abs(Math.sin(ang - NIB_EDGE)));
          const age = t >= b ? t - b : 0;
          const k = Math.max(0, 1 - age / 0.55);
          const c = this.ink.map((v, j) => Math.round(v + (this.wet[j] - v) * k));
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${this.alpha})`;
          ctx.beginPath();
          ctx.moveTo(ox + x0 * scale, oy + y0 * scale);
          ctx.lineTo(ox + ex * scale, oy + ey * scale);
          ctx.stroke();
          if (t <= b) { tip = [ox + ex * scale, oy + ey * scale]; down = true; }
        }
      });
      if (showNib) {
        if (!tip) {
          const last = this.lines[this.lines.length - 1];
          const seg = last.segs[last.segs.length - 1];
          const [ox, oy] = this.origin(this.lines.length - 1);
          if (seg) tip = [ox + seg[2] * scale, oy + seg[3] * scale];
        }
        if (tip) this.drawNib(tip, down);
      }
    }

    drawNib([x, y], down) {
      const { ctx } = this;
      const size = this.nibSize;
      const lift = down ? 0 : size * 0.08;
      ctx.save();
      ctx.translate(x + lift * 0.6, y - lift);
      ctx.rotate(NIB_ANGLE);
      ctx.scale(size / 0.68, size / 0.68);
      ctx.globalAlpha = this.nibAlpha == null ? 1 : this.nibAlpha;
      ctx.fillStyle = this.nibFill;
      ctx.fill(NIB, "evenodd");
      ctx.fillStyle = this.collar;
      ctx.fill(BAND);
      ctx.restore();
    }

    /** Write the text; resolves when the ink is down and the nib has lifted away. */
    async write(text) {
      const run = ++this.run;
      await this.prepare(text);
      this.alpha = 1;
      this.text = text;
      if (reduceMotion) { this.draw(Infinity, false); return; }
      const speed = this.opts.speed || 1;
      const total = this.duration + 0.6;
      return new Promise((resolve) => {
        let start = null;
        const frame = (now) => {
          if (run !== this.run || !this.canvas.isConnected) return resolve();
          if (start === null) start = now;
          const t = ((now - start) / 1000) * speed;
          if (t < this.duration) {
            this.nibAlpha = 1;
            this.draw(t, true);
            requestAnimationFrame(frame);
          } else if (t < total) {
            // the nib lifts away as the last of the ink dries
            this.nibAlpha = Math.max(0, 1 - (t - this.duration) / 0.6);
            this.draw(t, true);
            requestAnimationFrame(frame);
          } else {
            this.draw(Infinity, false);
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    }

    /** Fade what's written away. */
    fade(ms = 380) {
      const run = ++this.run;
      if (reduceMotion || !this.lines) return Promise.resolve();
      return new Promise((resolve) => {
        const start = performance.now();
        const frame = (now) => {
          if (run !== this.run || !this.canvas.isConnected) return resolve();
          this.alpha = Math.max(0, 1 - (now - start) / ms);
          this.draw(Infinity, false);
          if (this.alpha > 0) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
    }

    /** Redraw finished writing (after a resize or a theme change). */
    refresh() {
      if (!this.lines) return;
      this.fit();
      this.colours();
      this.draw(Infinity, false);
    }

    stop() { this.run++; }
  }

  window.MikePen = { Writer, ready: font, reduceMotion };
})();
