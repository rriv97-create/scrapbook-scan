// Find each item (photo, ticket, card, clipping) stuck on a scrapbook page.
// Pure functions, no app imports, so they run in the tests on a computer.
//
// How it works, on a small copy of the page photo (about 400 px wide):
// 1. Find the page colour: the most common colour, counting the outer edge of the photo extra.
// 2. Mark pixels that differ from the page colour, or sit on a strong edge (a white photo
//    border on white paper still has an edge).
// 3. Close small gaps so each item becomes one solid patch, then drop specks and pen lines.
// 4. Each patch gets the smallest rectangle around it, turned to match the item, so photos stuck
//    on at an angle come out straight.
// 5. Ask when unsure: anything irregular, touching the edge, or a page with nothing clear is
//    marked "check" so the person looks before it's saved. A wrong crop is worse than a tap.

export type RotRect = {
  /** Centre, in pixels of the image the rectangle belongs to. */
  cx: number; cy: number;
  /** Size along the item's own sides. */
  w: number; h: number;
  /** Degrees the item is turned clockwise on the page, from -45 to 45. */
  angle: number;
};
export type Found = RotRect & {
  /** How much of its rectangle the item fills (1 = a clean rectangle like a photo). */
  fill: number;
  /** Clear enough to save without a look. */
  sure: boolean;
};
export type Detection = {
  items: Found[];
  /** Page colour that was found, RGB. */
  page: [number, number, number];
  status: 'ready' | 'check';
  /** Plain-words reason when status is 'check'. */
  why: string;
};

// ---------- tuning (fractions of the small image unless noted) ----------
export const SETTINGS = {
  /** Smallest item kept, as a share of the page. Smaller things are embellishments. */
  MIN_AREA: 0.012,
  /** An item bigger than this is the page itself (or the table around it). */
  MAX_AREA: 0.85,
  /** Shortest side kept, as a share of the page's short side (drops pen lines and ribbon). */
  MIN_SIDE: 0.05,
  /** Items filling their rectangle at least this well, away from the edge, are saved without a look. */
  SURE_FILL: 0.82,
  /** Below this the shape is too irregular to trust at all. */
  MIN_FILL: 0.4,
  /** Gap-closing radius. */
  CLOSE_R: 0.012,
  /** Speck-removing radius. */
  OPEN_R: 0.006,
  /** Brightness step (0–255) at an edge that counts as an item border. Paper grain stays well below it. */
  EDGE: 16,
  /** Colour distance from the page always counted as "item", whatever the paper's texture. */
  MIN_DIST: 24,
  MAX_DIST: 70,
  /** A side row or column less full than this is trimmed off. */
  TRIM_BELOW: 0.5,
  /** Trimming more than this share means something odd was attached: ask. */
  TRIM_SURE: 0.08,
  /** Turned less than this (degrees) is treated as straight. */
  SNAP_DEG: 1.5,
};

type Img = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** Colour as brightness plus two colour axes. Brightness counts less, so uneven light matters less. */
function lab(r: number, g: number, b: number): [number, number, number] {
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  return [L * 0.45, r - g, 0.5 * (r + g) - b];
}

export function findPageColour(img: Img): { rgb: [number, number, number]; spread: number } {
  const { width: w, height: h, data } = img;
  const bins = new Float64Array(512);
  // The outer edge is left out: the table or a lap often shows there, and paper fills the middle.
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.06));
  const inner = (x: number, y: number) => x >= ring && y >= ring && x < w - ring && y < h - ring;
  const binOf = (j: number) => ((data[j] >> 5) << 6) | ((data[j + 1] >> 5) << 3) | (data[j + 2] >> 5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inner(x, y)) bins[binOf((y * w + x) * 4)]++;
  let best = 0;
  for (let i = 1; i < 512; i++) if (bins[i] > bins[best]) best = i;
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let j = 0; j < data.length; j += 4) {
    if (binOf(j) === best) { sr += data[j]; sg += data[j + 1]; sb += data[j + 2]; n++; }
  }
  const rgb: [number, number, number] = n ? [sr / n, sg / n, sb / n] : [255, 255, 255];
  // How much the paper itself varies (texture, uneven light): typical distance of paper-like pixels.
  const P = lab(...rgb);
  const ds: number[] = [];
  for (let j = 0; j < data.length; j += 12) {
    const q = lab(data[j], data[j + 1], data[j + 2]);
    const d = Math.hypot(q[0] - P[0], q[1] - P[1], q[2] - P[2]);
    if (d < 40) ds.push(d);
  }
  ds.sort((a, b) => a - b);
  const spread = ds.length ? ds[Math.floor(ds.length * 0.5)] : 0;
  return { rgb, spread };
}

/** Pixels that belong to an item: far from the page colour, or on a strong edge. */
export function itemMask(img: Img, page: [number, number, number], spread: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const S = SETTINGS;
  const P = lab(...page);
  const limit = Math.min(S.MAX_DIST, Math.max(S.MIN_DIST, spread * 3 + 14));
  const luma = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const r = data[j], g = data[j + 1], b = data[j + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const q = lab(r, g, b);
    if (Math.hypot(q[0] - P[0], q[1] - P[1], q[2] - P[2]) > limit) mask[i] = 1;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1];
      const gy = luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1];
      if (Math.abs(gx) + Math.abs(gy) > S.EDGE * 4) mask[i] = 1;
    }
  }
  return mask;
}

/** Count of set pixels in every (2r+1)² window, via a summed-area table. */
function windowSums(m: Uint8Array, w: number, h: number, r: number): { sum: Int32Array; size: Int32Array } {
  const W = w + 1;
  const S = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += m[y * w + x];
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + row;
    }
  }
  const sum = new Int32Array(w * h);
  const size = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      sum[y * w + x] = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      size[y * w + x] = (y1 - y0) * (x1 - x0);
    }
  }
  return { sum, size };
}
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return m;
  const { sum } = windowSums(m, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = sum[i] > 0 ? 1 : 0;
  return out;
}
export function erode(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return m;
  const { sum, size } = windowSums(m, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = sum[i] === size[i] ? 1 : 0;
  return out;
}

type Pt = [number, number];
const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (Andrew's monotone chain). */
export function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/** Smallest rectangle around a convex hull (one side always lies along a hull edge). */
export function minAreaRect(h: Pt[]): RotRect {
  let best: { area: number; rect: RotRect } | null = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(t), s = Math.sin(t);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of h) {
      const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c;
      if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area - 1e-9) {
      const mu = (x0 + x1) / 2, mv = (y0 + y1) / 2;
      best = { area, rect: { cx: mu * c - mv * s, cy: mu * s + mv * c, w: x1 - x0, h: y1 - y0, angle: (t * 180) / Math.PI } };
    }
  }
  if (!best) return { cx: 0, cy: 0, w: 0, h: 0, angle: 0 };
  return normalize(best.rect);
}

/** Same rectangle, described with its angle between -45 and 45 degrees. */
export function normalize(r: RotRect): RotRect {
  let { w, h, angle } = r;
  angle = ((angle % 180) + 180) % 180; // 0..180
  if (angle > 135) angle -= 180;
  else if (angle > 45) { angle -= 90; [w, h] = [h, w]; }
  return { ...r, w, h, angle: angle === -45 ? 45 : angle };
}

/** The four corners of a turned rectangle (top-left, top-right, bottom-right, bottom-left of the item). */
export function corners(r: RotRect): Pt[] {
  const t = (r.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[]).map(([u, v]) => {
    const x = (u * r.w) / 2, y = (v * r.h) / 2;
    return [r.cx + x * c - y * s, r.cy + x * s + y * c] as Pt;
  });
}

function bboxOf(r: RotRect) {
  const p = corners(r);
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
/** Share of A's box that lies inside B's box. */
function insideShare(a: RotRect, b: RotRect): number {
  const A = bboxOf(a), B = bboxOf(b);
  const ix = Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0));
  const iy = Math.max(0, Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0));
  const area = (A.x1 - A.x0) * (A.y1 - A.y0);
  return area > 0 ? (ix * iy) / area : 0;
}

/**
 * Shrink a rectangle from each side while that side's outermost line of pixels is mostly empty.
 * The item's own edge is a full line, so trimming stops there; things poking out are thin.
 */
export function trimSides(r: RotRect, pix: Int32Array, count: number, w: number): RotRect {
  const t = (r.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const U = Math.max(1, Math.ceil(r.w)), V = Math.max(1, Math.ceil(r.h));
  const byU = new Float64Array(U), byV = new Float64Array(V);
  for (let k = 0; k < count; k++) {
    const i = pix[k];
    const x = (i % w) + 0.5 - r.cx, y = Math.floor(i / w) + 0.5 - r.cy;
    const u = Math.floor(x * c + y * s + r.w / 2), v = Math.floor(-x * s + y * c + r.h / 2);
    if (u >= 0 && u < U) byU[u]++;
    if (v >= 0 && v < V) byV[v]++;
  }
  const cut = (line: Float64Array, across: number) => {
    const need = across * SETTINGS.TRIM_BELOW;
    let a = 0, b = line.length - 1;
    while (a < b && line[a] < need) a++;
    while (b > a && line[b] < need) b--;
    return [a, b + 1];
  };
  const [u0, u1] = cut(byU, r.h);
  const [v0, v1] = cut(byV, r.w);
  // Nothing full enough at all: leave it as it was.
  if (u1 - u0 < 2 || v1 - v0 < 2) return r;
  const mu = (u0 + u1) / 2 - r.w / 2, mv = (v0 + v1) / 2 - r.h / 2;
  return { cx: r.cx + mu * c - mv * s, cy: r.cy + mu * s + mv * c, w: u1 - u0, h: v1 - v0, angle: r.angle };
}

/** Find the items on a page. `img` is a small RGBA copy of the page photo. */
export function detectItems(img: Img): Detection {
  const { width: w, height: h } = img;
  const S = SETTINGS;
  const N = w * h;
  const short = Math.min(w, h);
  const { rgb, spread } = findPageColour(img);
  let m = itemMask(img, rgb, spread);
  const rc = Math.max(1, Math.round(short * S.CLOSE_R));
  const ro = Math.max(1, Math.round(short * S.OPEN_R));
  m = erode(dilate(m, w, h, rc), w, h, rc); // close gaps
  m = dilate(erode(m, w, h, ro), w, h, ro); // drop specks and thin lines

  // Connected patches (4-neighbour flood fill).
  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const pix = new Int32Array(N);
  const found: Found[] = [];
  let next = 0;
  const minX = new Int32Array(h), maxX = new Int32Array(h);
  for (let start = 0; start < N; start++) {
    if (!m[start] || label[start]) continue;
    next++;
    minX.fill(w); maxX.fill(-1);
    let top = 0, count = 0, yMin = h, yMax = -1, xMin = w, xMax = -1;
    stack[top++] = start; label[start] = next;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      pix[count++] = i;
      if (x < minX[y]) minX[y] = x; if (x > maxX[y]) maxX[y] = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (x > 0 && m[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && m[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && m[i - w] && !label[i - w]) { label[i - w] = next; stack[top++] = i - w; }
      if (y < h - 1 && m[i + w] && !label[i + w]) { label[i + w] = next; stack[top++] = i + w; }
    }
    if (count < N * S.MIN_AREA * 0.5) continue;
    // A patch running right round the photo is the table around the page, not an item.
    if (xMin === 0 && yMin === 0 && xMax === w - 1 && yMax === h - 1) continue;
    // Area with holes filled row by row (a photo with a pale sky still counts as solid).
    let solid = 0;
    const pts: Pt[] = [];
    for (let y = yMin; y <= yMax; y++) {
      if (maxX[y] < 0) continue;
      solid += maxX[y] - minX[y] + 1;
      pts.push([minX[y], y], [maxX[y] + 1, y], [minX[y], y + 1], [maxX[y] + 1, y + 1]);
    }
    if (solid < N * S.MIN_AREA) continue;
    let r = minAreaRect(hull(pts));
    if (r.w * r.h > N * S.MAX_AREA) continue;
    // Trim thin things stuck to the item's sides (a pen line, a ribbon end, tape).
    const before = r.w * r.h;
    r = trimSides(r, pix, count, w);
    const trimmed = 1 - (r.w * r.h) / Math.max(1, before);
    if (Math.min(r.w, r.h) < short * S.MIN_SIDE) continue;
    const fill = Math.min(1, solid / Math.max(1, before));
    if (fill < S.MIN_FILL) continue;
    if (Math.abs(r.angle) < S.SNAP_DEG) {
      // Nearly straight: use the plain box around it, so no corner is nibbled by a tiny turn.
      const b = bboxOf(r);
      r = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w: b.x1 - b.x0, h: b.y1 - b.y0, angle: 0 };
    }
    const touches = xMin === 0 || yMin === 0 || xMax === w - 1 || yMax === h - 1;
    found.push({ ...r, fill, sure: fill >= S.SURE_FILL && !touches && trimmed < S.TRIM_SURE });
  }

  // Something lying on top of a photo (a sticker) belongs to the photo: keep only the bigger one.
  found.sort((a, b) => b.w * b.h - a.w * a.h);
  const items: Found[] = [];
  for (const f of found) if (!items.some((k) => insideShare(f, k) > 0.8)) items.push(f);
  // Reading order: top to bottom, then left to right within a row.
  items.sort((a, b) => (Math.abs(a.cy - b.cy) < Math.min(a.h, b.h) / 2 ? a.cx - b.cx : a.cy - b.cy));

  let status: Detection['status'] = 'ready';
  let why = '';
  if (!items.length) { status = 'check'; why = 'No separate items found. Mark them, or keep the whole page.'; }
  else if (items.some((f) => !f.sure)) { status = 'check'; why = 'Some items are an odd shape or run off the edge. Check the boxes.'; }
  return { items, page: [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])], status, why };
}

/** Move a rectangle found on the small copy into full-size photo pixels. */
export function scaleRect<T extends RotRect>(r: T, sx: number, sy = sx): T {
  return { ...r, cx: r.cx * sx, cy: r.cy * sy, w: r.w * sx, h: r.h * sy };
}
