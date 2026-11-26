import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { detectItems, scaleRect } from './detect';
import { planCut, wholeRect, type Crop } from './geometry';
import { readPixels } from './pixels';
import { measure, verdict, type Verdict } from './quality';
import {
  addItems, addPage, deleteItemsOfPage, folder, get, load, newId, patchPage,
  type Box, type Item, type Page,
} from './store';

// From camera frame to saved items: save the page photo at full quality, find the items on it,
// and cut each one out (straightened) at full resolution. All on the phone.

/** Long side of the small copy used to find items. Bigger finds smaller items but takes longer. */
const DETECT_LONG = 520;
/** JPEG quality for saved page and item photos (1 = best). */
const SAVE_QUALITY = 0.95;
/** Border kept round each cut item, as a share of its size, so its edge is never trimmed. */
const CUT_PAD = 0.012;

export type Settings = {
  /** Cut items out as soon as they're found clearly (otherwise every page waits for a look). */
  autoCut: boolean;
  /** Also keep each whole page as an item. */
  keepPages: boolean;
  /** Use the camera's biggest picture size. */
  best: boolean;
  /** Guide frame shape. */
  shape: 'square' | 'portrait' | 'landscape';
};
const SETTINGS_KEY = 'scrapbook-scan.settings';
export const DEFAULT_SETTINGS: Settings = { autoCut: true, keepPages: false, best: true, shape: 'square' };
let settings: Settings = DEFAULT_SETTINGS;
export async function loadSettings(): Promise<Settings> {
  try { const raw = await AsyncStorage.getItem(SETTINGS_KEY); if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch {}
  return settings;
}
export function saveSettings(s: Settings) {
  settings = s;
  AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s)).catch(() => {});
}

/** Quick check on a camera frame: bright, sharp and free of glare. Lets it through if unreadable. */
export async function checkPhoto(uri: string, crop?: Crop): Promise<Verdict> {
  const px = await readPixels(uri, 600, crop);
  if (!px) return { ok: true };
  return verdict(measure(px.width, px.height, px.data));
}

/** Keep a camera frame as a new page of the scrapbook (just the framed part). */
export async function savePage(albumId: string, cameraUri: string, crop?: Crop): Promise<Page> {
  await load();
  const id = newId();
  const dest = new File(folder(albumId, 'pages'), `${id}.jpg`);
  let ctx = ImageManipulator.manipulate(cameraUri);
  if (crop) ctx = ctx.crop(crop);
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: SAVE_QUALITY });
  new File(out.uri).move(dest);
  const page = addPage({ id, albumId, uri: dest.uri, w: out.width, h: out.height, at: new Date().toISOString() });
  startFinding();
  return page;
}

/** Find the items on one page and store them as boxes. */
export async function findOn(page: Page): Promise<void> {
  const long = Math.max(page.w, page.h);
  const width = Math.round((DETECT_LONG * page.w) / long);
  const px = await readPixels(page.uri, width);
  if (!px) { patchPage(page.id, { status: 'check', why: 'Couldn’t read this page. Mark the items by hand.', boxes: [] }); return; }
  const d = detectItems(px);
  const sx = page.w / px.width, sy = page.h / px.height;
  const boxes: Box[] = d.items.map((f) => ({ ...scaleRect(f, sx, sy), id: newId(), on: true, sure: f.sure }));
  patchPage(page.id, { status: d.status, why: d.why || undefined, boxes });
  if (d.status === 'ready' && settings.autoCut) await cutPage(page.id);
}

/** Cut the chosen boxes out of a page at full size, straightened. Replaces earlier cuts of it. */
export async function cutPage(pageId: string): Promise<number> {
  const page = get().pages.find((p) => p.id === pageId);
  if (!page) return 0;
  deleteItemsOfPage(pageId);
  const boxes = page.boxes.filter((b) => b.on);
  if (settings.keepPages && !boxes.some((b) => b.w >= page.w * 0.97 && b.h >= page.h * 0.97)) {
    boxes.push({ ...wholeRect(page.w, page.h), id: 'page', on: true });
  }
  const made: Item[] = [];
  const dir = folder(page.albumId, 'items');
  for (const b of boxes) {
    try {
      const plan = planCut(page.w, page.h, b, b.id === 'page' ? 0 : CUT_PAD);
      let ctx = ImageManipulator.manipulate(page.uri);
      if (plan.rotate) ctx = ctx.rotate(plan.rotate);
      const img = await ctx.crop(plan.crop).renderAsync();
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: SAVE_QUALITY });
      const id = newId();
      const dest = new File(dir, `${id}.jpg`);
      new File(out.uri).move(dest);
      made.push({ id, albumId: page.albumId, pageId, uri: dest.uri, w: out.width, h: out.height, at: new Date().toISOString(), k: made.length, caption: '' });
    } catch {
      // One item that can't be cut doesn't stop the rest.
    }
  }
  // Keep page order: item 1 of page 1 first.
  addItems(made);
  patchPage(pageId, { status: 'done', why: undefined });
  return made.length;
}

// ---------- one page at a time, in the background ----------
let running = false;
export function startFinding() {
  if (running) return;
  running = true;
  (async () => {
    try {
      await load();
      await loadSettings();
      for (;;) {
        const next = [...get().pages].reverse().find((p) => p.status === 'finding');
        if (!next) break;
        try { await findOn(next); }
        catch { patchPage(next.id, { status: 'check', why: 'Couldn’t read this page. Mark the items by hand.' }); }
      }
    } finally {
      running = false;
    }
  })();
}
