"use strict";
// Spotting a new, steady page in the camera. Pure functions (from the catalog mode kit's
// catalog.ts, tuned for scrapbook pages), so the tests can run them on a computer.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TUNING = void 0;
exports.frameFrom = frameFrom;
exports.difference = difference;
exports.judge = judge;
// Measured inside the guide frame only, on a 24-pixel-wide copy, so hand shake and whatever is
// around the book (table, lap) don't count.
exports.TUNING = {
    /** Two frames this similar in a row mean the page is being held still. */
    STEADY_BELOW: 0.12,
    /** A steady frame must differ this much from recent captures to count as a new page. */
    NEW_PAGE_ABOVE: 0.2,
    /** Less detail than this is an empty table or a blank wall. */
    MIN_DETAIL: 5,
    /** Nearly colourless AND plain: a blank page or the inside cover, not worth a capture. */
    PLAIN_COLOR: 8,
    PLAIN_DETAIL: 9,
    /** Pause after a capture so the hand turning the page doesn't cause a double capture. */
    CAPTURE_GAP_MS: 1500,
    /** How many recent pages a new one is compared against (no duplicates). */
    REMEMBER: 10,
};
/** Brightness grid of a tiny copy of the frame, plus how much detail and colour it has. */
function frameFrom(w, h, rgba) {
    const n = w * h;
    const luma = new Float32Array(n);
    let sum = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
        const y = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
        luma[i] = y;
        sum += y;
    }
    const mean = n ? sum / n : 0;
    let grad = 0, count = 0;
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const i = y * w + x;
            grad += Math.abs(luma[i + 1] - luma[i]) + Math.abs(luma[i + w] - luma[i]);
            count++;
        }
    }
    // Colourfulness (Hasler & Süsstrunk).
    let rgS = 0, ybS = 0, rgQ = 0, ybQ = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
        const rg = rgba[j] - rgba[j + 1];
        const yb = 0.5 * (rgba[j] + rgba[j + 1]) - rgba[j + 2];
        rgS += rg;
        ybS += yb;
        rgQ += rg * rg;
        ybQ += yb * yb;
    }
    const rgM = n ? rgS / n : 0, ybM = n ? ybS / n : 0;
    const rgSd = Math.sqrt(Math.max(0, (n ? rgQ / n : 0) - rgM * rgM));
    const ybSd = Math.sqrt(Math.max(0, (n ? ybQ / n : 0) - ybM * ybM));
    const color = Math.sqrt(rgSd * rgSd + ybSd * ybSd) + 0.3 * Math.sqrt(rgM * rgM + ybM * ybM);
    return { w, h, luma, mean, detail: count ? grad / count : 0, color };
}
/** How different two frames are, 0 (same) to about 1, with overall brightness taken out. */
function difference(a, b) {
    if (a.w !== b.w || a.h !== b.h)
        return 1;
    let d = 0;
    for (let i = 0; i < a.luma.length; i++)
        d += Math.abs((a.luma[i] - a.mean) - (b.luma[i] - b.mean));
    return d / a.luma.length / 128;
}
/** 'capture' when a detailed, steady frame shows a page that isn't one of the recent captures. */
function judge(w, f, now = Date.now()) {
    const T = exports.TUNING;
    const steady = w.prev ? difference(w.prev, f) : 1;
    const change = w.recent.length ? Math.min(...w.recent.map((r) => difference(r, f))) : 1;
    if (f.detail < T.MIN_DETAIL)
        return { action: 'wait', why: 'nothing there', steady, change };
    if (f.color < T.PLAIN_COLOR && f.detail < T.PLAIN_DETAIL)
        return { action: 'wait', why: 'blank page', steady, change };
    if (w.lastAt && now - w.lastAt < T.CAPTURE_GAP_MS)
        return { action: 'wait', why: 'just captured', steady, change };
    if (steady >= T.STEADY_BELOW)
        return { action: 'wait', why: 'moving', steady, change };
    if (change <= T.NEW_PAGE_ABOVE)
        return { action: 'wait', why: 'already captured', steady, change };
    return { action: 'capture', why: 'new page', steady, change };
}
