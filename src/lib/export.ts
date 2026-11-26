import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { get, patchItem, type Item } from './store';

// Getting photos off the app: into the phone's Photos (an album named after the scrapbook),
// or out through the share sheet (Drive, email, a computer).

export type SaveResult = { saved: number; failed: number; denied?: boolean };

async function allowed(): Promise<boolean> {
  try {
    const p = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
    return p.granted;
  } catch {
    return false;
  }
}

/** Save items to Photos, in an album with the scrapbook's name. Skips ones already saved. */
export async function saveToPhotos(items: Item[], albumName: string, again = false): Promise<SaveResult> {
  const todo = again ? items : items.filter((i) => !i.inPhotos);
  if (!todo.length) return { saved: 0, failed: 0 };
  if (!(await allowed())) return { saved: 0, failed: todo.length, denied: true };
  let album: MediaLibrary.Album | null = null;
  try { album = await MediaLibrary.getAlbumAsync(albumName); } catch {}
  let saved = 0, failed = 0;
  for (const i of todo) {
    try {
      const asset = await MediaLibrary.createAssetAsync(i.uri);
      try {
        if (!album) album = await MediaLibrary.createAlbumAsync(albumName, asset, false);
        else await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } catch {
        // Saved to Photos, just not into the album (some phones don't allow it). Still counts.
      }
      patchItem(i.id, { inPhotos: true });
      saved++;
    } catch {
      failed++;
    }
  }
  return { saved, failed };
}

export async function share(uri: string): Promise<boolean> {
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', dialogTitle: 'Share photo' });
    return true;
  } catch {
    return false;
  }
}

/** Items of a scrapbook in page order (page 1 item 1 first). */
export function itemsInOrder(albumId: string): Item[] {
  const s = get();
  const pageN = new Map(s.pages.map((p) => [p.id, p.n]));
  return s.items
    .filter((i) => i.albumId === albumId)
    .sort((a, b) => (pageN.get(a.pageId) ?? 1e9) - (pageN.get(b.pageId) ?? 1e9) || a.k - b.k);
}
