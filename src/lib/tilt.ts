// Which way to tilt the phone so it's square to the cover, from the accelerometer (expo-sensors).
// Pure functions, no app imports, so they can be tested on their own.
//
// Two ways people catalog: book lying flat with the phone held flat over it (screen up), or book
// standing up with the phone held upright in front of it. Gravity tells which, and how far off.
// Only ratios between axes are used, so it doesn't matter whether a platform reports gravity as
// +1 g or -1 g on an axis.

export type Accel = { x: number; y: number; z: number };
export type Edge = 'left' | 'right' | 'top' | 'bottom';
export type Tilt = {
  /** flat: phone over a book lying down. upright: phone in front of a standing book. */
  mode: 'flat' | 'upright' | 'unknown';
  /** Degrees away from square to the book. */
  angle: number;
  /** "Tilt toward this edge" (move it away from you), with how far off on that axis in degrees. */
  edges: Partial<Record<Edge, number>>;
};

const DEG = 180 / Math.PI;
/** Further than this from flat or upright (degrees) and we can't tell which the user means. */
const MODE_LIMIT = 40;
/** An axis this close (degrees) gets no arrow. */
const EDGE_FROM = 4;

export function tiltFrom(a: Accel): Tilt {
  const g = Math.hypot(a.x, a.y, a.z);
  if (!g) return { mode: 'unknown', angle: 90, edges: {} };
  const cosLimit = Math.cos(MODE_LIMIT / DEG);
  const edges: Tilt['edges'] = {};
  const put = (deg: number, pos: Edge, neg: Edge) => {
    if (deg > EDGE_FROM) edges[pos] = deg;
    else if (deg < -EDGE_FROM) edges[neg] = -deg;
  };

  if (Math.abs(a.z) / g >= cosLimit) {
    // Flat, screen up. Side-to-side: gravity toward the right edge means the right side is low,
    // so tip the high left side down ("tilt toward the left edge"). Same for top and bottom.
    const side = -Math.atan(a.x / a.z) * DEG;  // > 0: right edge low
    const ends = -Math.atan(a.y / a.z) * DEG;  // > 0: top edge low
    put(side, 'left', 'right');
    put(ends, 'bottom', 'top');
    return { mode: 'flat', angle: Math.acos(Math.min(1, Math.abs(a.z) / g)) * DEG, edges };
  }
  if (Math.abs(a.y) / g >= cosLimit) {
    // Upright in portrait. Leaning the top toward you tips gravity out of the screen:
    // "tilt toward the top edge" (push the top away). Side-to-side lean is just a turned picture,
    // which reading copes with, so it gets no arrow.
    const lean = -Math.atan(a.z / a.y) * DEG;  // > 0: top leaning toward you
    put(lean, 'top', 'bottom');
    return { mode: 'upright', angle: Math.abs(lean), edges };
  }
  return { mode: 'unknown', angle: 90, edges: {} };
}

/** Running measure of hand shake in g (smoothed change between readings). */
export function shakeStep(prev: Accel | null, a: Accel, smoothed: number): number {
  if (!prev) return smoothed;
  const jump = Math.hypot(a.x - prev.x, a.y - prev.y, a.z - prev.z);
  return smoothed * 0.7 + jump * 0.3;
}

export const SQUARE_WITHIN = 8;   // degrees: close enough to capture
export const NEARLY_WITHIN = 18;  // degrees: amber; beyond this, red
export const STEADY_BELOW = 0.03; // g of smoothed shake
export const SHAKING_ABOVE = 0.08;

export type Level = 'red' | 'amber' | 'green';

/** Frame colour from the phone's angle and shake alone (the camera adds "hold steady" on top). */
export function levelFor(t: Tilt, shake: number): Level {
  if (t.mode === 'unknown' || t.angle > NEARLY_WITHIN || shake > SHAKING_ABOVE) return 'red';
  if (t.angle > SQUARE_WITHIN || shake > STEADY_BELOW) return 'amber';
  return 'green';
}
