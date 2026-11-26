import { decode as b64decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { Crop } from './geometry';

export type Pixels = { width: number; height: number; data: Uint8Array };

type Decode = (d: Uint8Array, o: object) => Pixels;
let cached: Decode | null | undefined;
function decoder(): Decode | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('jpeg-js/lib/decoder');
    cached = typeof m === 'function' ? m : m?.decode ?? m?.default ?? null;
  } catch {
    cached = null;
  }
  return cached ?? null;
}

/** A small RGBA copy of (part of) a photo, for measuring on the phone. Null if it can't be read. */
export async function readPixels(uri: string, width: number, crop?: Crop): Promise<Pixels | null> {
  try {
    const decode = decoder();
    if (!decode) return null;
    let ctx = ImageManipulator.manipulate(uri);
    if (crop) ctx = ctx.crop(crop);
    const img = await ctx.resize({ width: Math.max(8, Math.round(width)), height: null }).renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
    if (!out.base64) return null;
    return decode(new Uint8Array(b64decode(out.base64)), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
  } catch {
    return null;
  }
}
