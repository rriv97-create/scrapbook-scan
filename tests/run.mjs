// Runs the page-reading code on made-up scrapbook pages. No phone needed.
//   cd tests && node run.mjs   (builds ../src/lib with tsc first)
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('build', { recursive: true });
execSync('tsc -p .', { stdio: 'inherit' });
const { detectItems, corners } = await import('./build/detect.js');
const { planCut, turnPoint } = await import('./build/geometry.js');
const { frameFrom, judge, TUNING } = await import('./build/frame.js');
const { measure, verdict } = await import('./build/quality.js');
const { tiltFrom, levelFor } = await import('./build/tilt.js');

let fails = 0;
const check = (ok, label, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

// ---------- a tiny page painter ----------
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function page(w, h, paper, { light = 14, noise = 6, stripes = null } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    const shade = -light * (x / w + y / h) / 2;
    const st = stripes && Math.floor(x / stripes.every) % 2 ? stripes.shift : 0;
    for (let c = 0; c < 3; c++) data[j + c] = paper[c] + shade + st + (rand() - 0.5) * noise;
    data[j + 3] = 255;
  }
  return { width: w, height: h, data };
}
/** A photo: colourful picture inside, optional white border, turned by `angle` degrees clockwise. */
function photo(img, { cx, cy, w, h, angle = 0, border = 0, tone = [90, 120, 170] }) {
  const t = (angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = dx * c + dy * s, v = -dx * s + dy * c; // into the photo's own axes
    const j = (y * img.width + x) * 4;
    if (Math.abs(u) > w / 2 || Math.abs(v) > h / 2) {
      // Soft shadow just below and right of a print (what makes white-on-white visible at all).
      if (border && u > -w / 2 && v > -h / 2 && u < w / 2 + 2.5 && v < h / 2 + 2.5) for (let k = 0; k < 3; k++) img.data[j + k] -= 28;
      continue;
    }
    const inBorder = Math.abs(u) > w / 2 - border || Math.abs(v) > h / 2 - border;
    // The print's cut edge catches a little shade all round.
    if (border && (Math.abs(u) > w / 2 - 1 || Math.abs(v) > h / 2 - 1)) { img.data[j] = img.data[j + 1] = img.data[j + 2] = 226; continue; }
    if (inBorder) { img.data[j] = 248; img.data[j + 1] = 247; img.data[j + 2] = 244; continue; }
    const k = (u / w + 0.5), q = (v / h + 0.5);
    const blob = Math.sin(u * 0.15) * Math.cos(v * 0.11) * 40;
    img.data[j] = tone[0] + k * 80 + blob + (rand() - 0.5) * 20;
    img.data[j + 1] = tone[1] - q * 60 + blob + (rand() - 0.5) * 20;
    img.data[j + 2] = tone[2] + (k - q) * 50 + (rand() - 0.5) * 20;
  }
}
function line(img, x0, y0, x1, y1, width = 1.5, rgb = [40, 40, 60]) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const vx = x1 - x0, vy = y1 - y0, L = Math.hypot(vx, vy);
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (L * L)));
    if (Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy)) <= width) {
      const j = (y * img.width + x) * 4; img.data[j] = rgb[0]; img.data[j + 1] = rgb[1]; img.data[j + 2] = rgb[2];
    }
  }
}
const near = (f, want, tol = { c: 5, s: 0.06, a: 1.5 }) =>
  Math.hypot(f.cx - want.cx, f.cy - want.cy) <= tol.c
  && Math.abs(f.w - want.w) / want.w <= tol.s && Math.abs(f.h - want.h) / want.h <= tol.s
  && Math.abs(f.angle - (want.angle ?? 0)) <= tol.a;
const show = (d) => d.items.map((f) => `(${f.cx.toFixed(0)},${f.cy.toFixed(0)} ${f.w.toFixed(0)}x${f.h.toFixed(0)} ${f.angle.toFixed(1)}° fill ${f.fill.toFixed(2)}${f.sure ? '' : ' ?'})`).join(' ');
function expectItems(label, img, wants) {
  const t0 = performance.now();
  const d = detectItems(img);
  const ms = (performance.now() - t0).toFixed(0);
  const matched = wants.every((w) => d.items.some((f) => near(f, w)));
  check(d.items.length === wants.length && matched, label, `${d.status} ${ms}ms ${show(d)}`);
  return d;
}

// 1. Three photos on cream paper, two stuck on at an angle.
{
  const img = page(400, 520, [232, 222, 200]);
  const want = [
    { cx: 110, cy: 120, w: 150, h: 110, angle: 0 },
    { cx: 290, cy: 150, w: 130, h: 170, angle: 12 },
    { cx: 200, cy: 380, w: 220, h: 150, angle: -7 },
  ];
  for (const p of want) photo(img, p);
  const d = expectItems('three photos, two tilted', img, want);
  check(d.status === 'ready', 'three photos saved without asking');
}
// 2. White-bordered prints on white paper (the hard case: only the border's edge shows).
{
  const img = page(400, 520, [244, 243, 240], { light: 6, noise: 4 });
  const want = [
    { cx: 120, cy: 150, w: 160, h: 200, angle: 5, border: 10, tone: [150, 110, 80] },
    { cx: 290, cy: 380, w: 170, h: 130, angle: -9, border: 8 },
  ];
  for (const p of want) photo(img, p);
  expectItems('white-bordered prints on white paper', img, want);
}
// 3. A blank page: nothing to cut out, so it asks.
{
  const d = detectItems(page(400, 520, [230, 225, 210]));
  check(d.items.length === 0 && d.status === 'check', 'blank page asks instead of guessing', d.why);
}
// 4. Table showing round the page.
{
  const img = page(400, 520, [235, 228, 210]);
  for (let y = 0; y < 520; y++) for (let x = 0; x < 400; x++) if (x < 22 || y < 22 || x > 377 || y > 497) {
    const j = (y * 400 + x) * 4; img.data[j] = 110; img.data[j + 1] = 72; img.data[j + 2] = 40;
  }
  const want = [{ cx: 140, cy: 160, w: 160, h: 120, angle: 3 }, { cx: 250, cy: 360, w: 170, h: 140, angle: -4 }];
  for (const p of want) photo(img, p);
  expectItems('table showing round the page is ignored', img, want);
}
// 5. Handwriting between two photos doesn't join them up.
{
  const img = page(400, 520, [232, 222, 200]);
  const want = [{ cx: 110, cy: 200, w: 150, h: 200, angle: 0 }, { cx: 300, cy: 200, w: 150, h: 200, angle: 0 }];
  for (const p of want) photo(img, p);
  line(img, 60, 340, 340, 330); line(img, 80, 360, 300, 365); line(img, 186, 120, 224, 260, 1.2);
  expectItems('handwriting between photos stays out', img, want);
}
// 6. Small sticker on a photo belongs to the photo.
{
  const img = page(400, 520, [232, 222, 200]);
  const want = [{ cx: 200, cy: 260, w: 260, h: 200, angle: 6 }];
  photo(img, want[0]);
  photo(img, { cx: 300, cy: 330, w: 50, h: 50, tone: [220, 40, 40] });
  expectItems('sticker on a photo stays part of it', img, want);
}
// 7. Striped paper: may not separate, but must not save a wrong crop silently.
{
  const img = page(400, 520, [200, 215, 235], { stripes: { every: 12, shift: -40 } });
  photo(img, { cx: 200, cy: 260, w: 200, h: 160, angle: 4 });
  const d = detectItems(img);
  const right = d.items.length === 1 && near(d.items[0], { cx: 200, cy: 260, w: 200, h: 160, angle: 4 });
  check(right || d.status === 'check', 'striped paper: right, or asks', `${d.status} ${show(d)}`);
}

// ---------- cutting at full size ----------
{
  const W = 4000, H = 3000;
  let worst = 0;
  for (const r of [{ cx: 1200, cy: 900, w: 1400, h: 1000, angle: 12 }, { cx: 2800, cy: 2000, w: 900, h: 1300, angle: -33 }, { cx: 2000, cy: 1500, w: 800, h: 600, angle: 0 }]) {
    const plan = planCut(W, H, r, 0);
    // The item's corners, turned the way the photo will be turned, should land on the crop's corners.
    const pts = corners(r).map(([x, y]) => turnPoint(W, H, plan.rotate, x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const c = plan.crop;
    worst = Math.max(worst, Math.abs(Math.min(...xs) - c.originX), Math.abs(Math.min(...ys) - c.originY),
      Math.abs(Math.max(...xs) - (c.originX + c.width)), Math.abs(Math.max(...ys) - (c.originY + c.height)));
  }
  check(worst <= 1.5, 'turn-then-crop lands exactly on the item', `worst ${worst.toFixed(2)} px`);
}

// ---------- capture decisions ----------
{
  const pageA = page(24, 32, [230, 220, 200]); photo(pageA, { cx: 8, cy: 10, w: 10, h: 12 }); photo(pageA, { cx: 17, cy: 22, w: 9, h: 10, tone: [200, 60, 60] });
  const pageB = page(24, 32, [230, 220, 200]); photo(pageB, { cx: 12, cy: 9, w: 18, h: 10, tone: [40, 160, 90] }); photo(pageB, { cx: 9, cy: 24, w: 10, h: 10 });
  const A = frameFrom(24, 32, pageA.data), A2 = frameFrom(24, 32, pageA.data), B = frameFrom(24, 32, pageB.data);
  const blank = frameFrom(24, 32, page(24, 32, [235, 233, 228], { noise: 2, light: 2 }).data);
  const w = { prev: null, recent: [], lastAt: 0 };
  const steps = [];
  const step = (f, now) => { const j = judge(w, f, now); w.prev = f; if (j.action === 'capture') { w.recent.unshift(f); w.lastAt = now; } steps.push(j.why); };
  step(A, 1000); step(A2, 1300); step(A2, 1600); step(A2, 4000); step(B, 4300); step(B, 4600); step(A, 7000); step(A, 7300); step(blank, 9000); step(blank, 9300);
  const want = ['moving', 'new page', 'just captured', 'already captured', 'moving', 'new page', 'moving', 'already captured', 'nothing there', 'nothing there'];
  check(JSON.stringify(steps) === JSON.stringify(want), 'turning pages: one capture each, no repeats, blank skipped', steps.join(', '));
}

// ---------- photo quality ----------
{
  const good = page(300, 400, [210, 200, 180]); photo(good, { cx: 150, cy: 200, w: 200, h: 260 });
  const glare = page(300, 400, [210, 200, 180]); photo(glare, { cx: 150, cy: 200, w: 200, h: 260 });
  for (let y = 120; y < 170; y++) for (let x = 100; x < 160; x++) { const j = (y * 300 + x) * 4; glare.data[j] = glare.data[j + 1] = glare.data[j + 2] = 255; }
  const white = page(300, 400, [253, 253, 253], { noise: 2, light: 0 }); photo(white, { cx: 150, cy: 200, w: 150, h: 150 });
  check(verdict(measure(300, 400, good.data)).ok, 'good page passes');
  check(verdict(measure(300, 400, glare.data)).problem === 'glare', 'glare spot is caught');
  check(verdict(measure(300, 400, white.data)).problem !== 'glare', 'bright white paper is not called glare');
}

// ---------- tilt guide (from the kit, unchanged) ----------
check(levelFor(tiltFrom({ x: 0, y: 0, z: -1 }), 0) === 'green', 'phone flat over the book is green');
check(levelFor(tiltFrom({ x: 0.3, y: 0, z: -0.95 }), 0) !== 'green', 'phone tipped 17° is not green');

console.log(fails ? `\n${fails} failed` : '\nAll passed');
process.exit(fails ? 1 : 0);
