import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';

import type { RotRect } from './detect';

// Everything lives on this phone: no account, no server, no upload. Photos are files in the
// app's documents folder; the list of scrapbooks, pages and items is one JSON entry.

export type Album = { id: string; name: string; at: string };
/** A box on a page photo, in full-size pixels. `on` = cut it out. `sure` = found clearly. */
export type Box = RotRect & { id: string; on: boolean; sure?: boolean };
export type PageStatus = 'finding' | 'ready' | 'check' | 'done';
export type Page = {
  id: string; albumId: string; n: number; uri: string; w: number; h: number; at: string;
  status: PageStatus; why?: string; boxes: Box[];
};
export type Item = {
  id: string; albumId: string; pageId: string; uri: string; w: number; h: number; at: string;
  /** Order on its page. */
  k: number;
  caption: string; inPhotos?: boolean;
};
type State = { albums: Album[]; pages: Page[]; items: Item[] };

const KEY = 'scrapbook-scan.v1';
let state: State = { albums: [], pages: [], items: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<(s: State) => void>();

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function folder(albumId: string, kind: 'pages' | 'items'): Directory {
  const d = new Directory(Paths.document, 'scrapbooks', albumId, kind);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export function load(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const s: State = raw ? JSON.parse(raw) : { albums: [], pages: [], items: [] };
      const exists = (uri: string) => { try { return new File(uri).exists; } catch { return false; } };
      state = {
        albums: s.albums ?? [],
        // A page that was being looked at when the app closed goes back in line.
        pages: (s.pages ?? []).filter((p) => exists(p.uri)),
        items: (s.items ?? []).filter((i) => exists(i.uri)),
      };
    } catch {
      state = { albums: [], pages: [], items: [] };
    }
    emit();
  })();
  return loaded;
}

function emit() {
  const snap = { ...state };
  listeners.forEach((fn) => fn(snap));
}
let timer: ReturnType<typeof setTimeout> | null = null;
function save() {
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {}); }, 250);
}

export function get(): State { return state; }

export function useStore(): State {
  const [s, set] = useState<State>(state);
  useEffect(() => {
    listeners.add(set);
    load().then(() => set({ ...state }));
    return () => { listeners.delete(set); };
  }, []);
  return s;
}

const deleteFile = (uri: string) => { try { const f = new File(uri); if (f.exists) f.delete(); } catch {} };

// ---------- scrapbooks ----------
export function addAlbum(name: string): Album {
  const a: Album = { id: newId(), name: name.trim() || 'My scrapbook', at: new Date().toISOString() };
  state = { ...state, albums: [a, ...state.albums] };
  save();
  return a;
}
export function renameAlbum(id: string, name: string) {
  state = { ...state, albums: state.albums.map((a) => (a.id === id ? { ...a, name: name.trim() || a.name } : a)) };
  save();
}
export function deleteAlbum(id: string) {
  try { const d = new Directory(Paths.document, 'scrapbooks', id); if (d.exists) d.delete(); } catch {}
  state = {
    albums: state.albums.filter((a) => a.id !== id),
    pages: state.pages.filter((p) => p.albumId !== id),
    items: state.items.filter((i) => i.albumId !== id),
  };
  save();
}

// ---------- pages ----------
export function addPage(p: Omit<Page, 'n' | 'status' | 'boxes'>): Page {
  const n = state.pages.filter((x) => x.albumId === p.albumId).reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const page: Page = { ...p, n, status: 'finding', boxes: [] };
  state = { ...state, pages: [page, ...state.pages] };
  save();
  return page;
}
export function patchPage(id: string, patch: Partial<Page>) {
  state = { ...state, pages: state.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
  save();
}
export function deletePage(id: string, withItems = false) {
  const p = state.pages.find((x) => x.id === id);
  if (p) deleteFile(p.uri);
  let items = state.items;
  if (withItems) {
    for (const i of items) if (i.pageId === id) deleteFile(i.uri);
    items = items.filter((i) => i.pageId !== id);
  }
  state = { ...state, pages: state.pages.filter((x) => x.id !== id), items };
  save();
}

// ---------- items ----------
export function addItems(list: Item[]) {
  state = { ...state, items: [...list, ...state.items] };
  save();
}
export function patchItem(id: string, patch: Partial<Item>) {
  state = { ...state, items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
  save();
}
export function deleteItem(id: string) {
  const i = state.items.find((x) => x.id === id);
  if (i) deleteFile(i.uri);
  state = { ...state, items: state.items.filter((x) => x.id !== id) };
  save();
}
/** Remove the items already cut from a page (before cutting it again). */
export function deleteItemsOfPage(pageId: string) {
  for (const i of state.items) if (i.pageId === pageId) deleteFile(i.uri);
  state = { ...state, items: state.items.filter((i) => i.pageId !== pageId) };
  save();
}
