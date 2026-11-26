"use strict";
// How to cut one item out of the full page photo: turn the photo so the item is straight,
// then crop. Pure maths, no app imports, so the tests can check it.
//
// Image coordinates have y pointing down, so a positive angle turns things clockwise on screen.
// expo-image-manipulator's rotate() turns clockwise for positive degrees and grows the canvas to
// fit the turned photo, keeping its centre in the middle; the maths below follows that.
Object.defineProperty(exports, "__esModule", { value: true });
exports.turnedSize = turnedSize;
exports.turnPoint = turnPoint;
exports.planCut = planCut;
exports.wholeRect = wholeRect;
/** Size of a W×H image after turning it by `deg` (canvas grows to fit). */
function turnedSize(W, H, deg) {
    const t = (deg * Math.PI) / 180;
    const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    return { width: W * c + H * s, height: W * s + H * c };
}
/** Where point (x, y) of a W×H image ends up after turning it by `deg`. */
function turnPoint(W, H, deg, x, y) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const out = turnedSize(W, H, deg);
    const dx = x - W / 2, dy = y - H / 2;
    return [out.width / 2 + dx * c - dy * s, out.height / 2 + dx * s + dy * c];
}
/**
 * Plan the cut for one item. `pad` adds a little border (share of the item's size) so the
 * item's own edge is never trimmed; detection on the small copy is only accurate to a pixel or two.
 */
function planCut(W, H, r, pad = 0.01) {
    const rotate = Math.abs(r.angle) < 0.01 ? 0 : -r.angle;
    const size = rotate ? turnedSize(W, H, rotate) : { width: W, height: H };
    const [cx, cy] = rotate ? turnPoint(W, H, rotate, r.cx, r.cy) : [r.cx, r.cy];
    const extra = pad * Math.max(r.w, r.h);
    let x0 = cx - r.w / 2 - extra, y0 = cy - r.h / 2 - extra;
    let x1 = cx + r.w / 2 + extra, y1 = cy + r.h / 2 + extra;
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(Math.floor(size.width), Math.ceil(x1));
    y1 = Math.min(Math.floor(size.height), Math.ceil(y1));
    return { rotate, crop: { originX: x0, originY: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) } };
}
/** Rectangle for the whole photo (used for "keep the whole page"). */
function wholeRect(W, H) {
    return { cx: W / 2, cy: H / 2, w: W, h: H, angle: 0 };
}
