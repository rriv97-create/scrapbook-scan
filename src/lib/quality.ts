// Is a page photo good enough to keep? Pure measuring (from the kit's photo-quality.ts, plus a
// glare check for glossy photos and plastic page protectors), so the tests can run it.

export const LIMITS = {
  TOO_DARK: 50,       // average brightness (0–255) below this is too dark
  TOO_BRIGHT: 240,    // above this the page is washed out
  TOO_BLURRY: 12,     // edge sharpness below this is blurry (on a 600 px copy)
  GLARE_LEVEL: 252,   // every channel this bright: a blown-out reflection
  GLARE_PAGE_BELOW: 238, // only judged when the typical pixel is darker than this (bright white paper isn't glare)
  GLARE_SHARE: 0.015, // more than this share of the page in glare spots needs a fix
};

export type Measure = { brightness: number; median: number; sharpness: number; glare: number };
export type Verdict = { ok: true } | { ok: false; problem: 'dark' | 'bright' | 'blurry' | 'glare'; message: string };

export function measure(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): Measure {
  const n = width * height;
  const luma = new Float32Array(n);
  let sum = 0, hot = 0;
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = y; sum += y; hist[Math.min(255, y | 0)]++;
    if (Math.min(r, g, b) >= LIMITS.GLARE_LEVEL) hot++;
  }
  // Variance of the Laplacian: sharp photos have strong edges, blurry ones don't.
  let lsum = 0, lsq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = luma[i - width] + luma[i + width] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      lsum += l; lsq += l * l; count++;
    }
  }
  const mean = count ? lsum / count : 0;
  let median = 0;
  for (let k = 0, seen = 0; k < 256; k++) { seen += hist[k]; if (seen >= n / 2) { median = k; break; } }
  return { brightness: n ? sum / n : 0, median, sharpness: count ? lsq / count - mean * mean : 0, glare: n ? hot / n : 0 };
}

export function verdict(m: Measure): Verdict {
  const L = LIMITS;
  if (m.brightness < L.TOO_DARK) return { ok: false, problem: 'dark', message: 'Too dark. Move to brighter, even light.' };
  if (m.brightness > L.TOO_BRIGHT) return { ok: false, problem: 'bright', message: 'Washed out. Move away from direct light.' };
  if (m.sharpness < L.TOO_BLURRY) return { ok: false, problem: 'blurry', message: 'Blurry. Hold still a moment.' };
  if (m.glare > L.GLARE_SHARE && m.median < L.GLARE_PAGE_BELOW) return { ok: false, problem: 'glare', message: 'Glare on the page. Tilt the book a little or move the light.' };
  return { ok: true };
}
