import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, PanResponder, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C } from '@/components/ui';
import { corners } from '@/lib/detect';
import { cutPage } from '@/lib/extract';
import { wholeRect } from '@/lib/geometry';
import { deletePage, get, newId, patchPage, useStore, type Box } from '@/lib/store';

// Look at what was found on a page before it's saved: keep or skip each box, move or resize it,
// straighten it a degree at a time, add one by hand, or keep the whole page.

type Drag = { mode: 'move' | 'size'; id: string; start: Box; x: number; y: number; moved: boolean; wasSelected: boolean };

/** Is point (x, y) inside the turned box? Works in full-size pixels. */
function inside(b: Box, x: number, y: number): boolean {
  const t = (b.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = x - b.cx, dy = y - b.cy;
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  return Math.abs(u) <= b.w / 2 && Math.abs(v) <= b.h / 2;
}

export default function PageReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const { pages, items } = useStore();
  const page = pages.find((p) => p.id === id);
  const [boxes, setBoxes] = useState<Box[]>(page?.boxes ?? []);
  const [sel, setSel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Boxes arrive late if the page is still being read when this opens.
  useEffect(() => { if (page && !dirty) setBoxes(page.boxes); }, [page?.boxes]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxW = screen.width - 32, maxH = screen.height * 0.56;
  const k = page ? Math.min(maxW / page.w, maxH / page.h) : 1; // screen points per photo pixel
  const dispW = page ? page.w * k : 0, dispH = page ? page.h * k : 0;

  // Refs so the gesture handler (made once) always sees the latest state.
  const ref = useRef({ boxes, sel, k, page });
  ref.current = { boxes, sel, k, page };
  const drag = useRef<Drag | null>(null);

  const update = (bid: string, patch: Partial<Box>) => {
    setDirty(true);
    setBoxes((list) => list.map((b) => (b.id === bid ? { ...b, ...patch } : b)));
  };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      const { boxes: list, sel: current, k: kk, page: pg } = ref.current;
      if (!pg) return;
      const x = e.nativeEvent.locationX / kk, y = e.nativeEvent.locationY / kk;
      const grab = 26 / kk; // finger-sized, in photo pixels
      const chosen = list.find((b) => b.id === current);
      if (chosen) {
        const [, , br] = corners(chosen);
        if (Math.hypot(br[0] - x, br[1] - y) < grab) {
          drag.current = { mode: 'size', id: chosen.id, start: chosen, x, y, moved: false, wasSelected: true };
          return;
        }
      }
      // Smallest box under the finger wins (so a small item on a big one can be picked).
      const hit = [...list].sort((a, b) => a.w * a.h - b.w * b.h).find((b) => inside(b, x, y));
      if (hit) {
        drag.current = { mode: 'move', id: hit.id, start: hit, x, y, moved: false, wasSelected: hit.id === current };
        setSel(hit.id);
      } else {
        drag.current = null;
        setSel(null);
      }
    },
    onPanResponderMove: (_e, g) => {
      const d = drag.current;
      const { k: kk, page: pg } = ref.current;
      if (!d || !pg) return;
      if (Math.hypot(g.dx, g.dy) > 6) d.moved = true;
      if (!d.moved) return;
      const dx = g.dx / kk, dy = g.dy / kk;
      if (d.mode === 'move') {
        update(d.id, { cx: Math.max(0, Math.min(pg.w, d.start.cx + dx)), cy: Math.max(0, Math.min(pg.h, d.start.cy + dy)) });
      } else {
        // Keep the top-left corner where it is; the dragged corner sets the new size.
        const b = d.start;
        const [tl] = corners(b);
        const t = (b.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
        const px = d.x + dx - tl[0], py = d.y + dy - tl[1];
        const min = Math.min(pg.w, pg.h) * 0.05;
        const w = Math.max(min, px * c + py * s), h = Math.max(min, -px * s + py * c);
        update(d.id, { w, h, cx: tl[0] + (w / 2) * c - (h / 2) * s, cy: tl[1] + (w / 2) * s + (h / 2) * c });
      }
    },
    onPanResponderRelease: () => {
      const d = drag.current;
      drag.current = null;
      // A tap on the box that was already picked keeps or skips it.
      if (d && !d.moved && d.mode === 'move' && d.wasSelected) {
        const b = ref.current.boxes.find((x) => x.id === d.id);
        if (b) update(d.id, { on: !b.on });
      }
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!page) return <View style={{ flex: 1, backgroundColor: C.paper }} />;
  const chosen = boxes.find((b) => b.id === sel) ?? null;
  const keep = boxes.filter((b) => b.on).length;
  const cutAlready = items.filter((i) => i.pageId === page.id).length;

  function add(whole = false) {
    if (!page) return;
    const b: Box = whole
      ? { ...wholeRect(page.w, page.h), id: newId(), on: true }
      : { cx: page.w / 2, cy: page.h / 2, w: page.w * 0.45, h: page.h * 0.35, angle: 0, id: newId(), on: true };
    setDirty(true);
    setBoxes((l) => [...l, b]);
    setSel(b.id);
  }
  function removeBox() {
    if (!chosen) return;
    setDirty(true);
    setBoxes((l) => l.filter((b) => b.id !== chosen.id));
    setSel(null);
  }
  async function save() {
    if (!page) return;
    setSaving(true);
    try {
      patchPage(page.id, { boxes });
      const n = await cutPage(page.id);
      // On to the next page that needs a look, if there is one.
      const next = get().pages.filter((p) => p.albumId === page.albumId && (p.status === 'check' || p.status === 'ready') && p.id !== page.id).sort((a, b) => a.n - b.n)[0];
      if (n === 0 && keep > 0) Alert.alert('Couldn’t save', 'The items couldn’t be cut out. Try again.');
      else if (next) router.replace(`/page/${next.id}`);
      else router.back();
    } finally {
      setSaving(false);
    }
  }
  function removePage() {
    Alert.alert(`Delete page ${page!.n}?`, cutAlready ? `Its photo and the ${cutAlready} item${cutAlready === 1 ? '' : 's'} cut from it are deleted.` : 'Its photo is deleted.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deletePage(page!.id, true); router.back(); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}>
      <Text style={{ color: page.status === 'check' ? C.warn : C.muted, lineHeight: 20 }}>
        {page.status === 'finding' ? 'Finding photos on this page…'
          : page.why ?? (cutAlready ? `Page ${page.n}: ${cutAlready} item${cutAlready === 1 ? '' : 's'} saved. Change the boxes and save again if you like (this replaces them, notes included).` : `Page ${page.n}`)}
      </Text>
      <View style={{ width: dispW, height: dispH, alignSelf: 'center' }} {...pan.panHandlers}>
        <Image source={{ uri: page.uri }} style={{ width: dispW, height: dispH, borderRadius: 4 }} pointerEvents="none" />
        {boxes.map((b, i) => {
          const picked = b.id === sel;
          return (
            <View
              key={b.id}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: (b.cx - b.w / 2) * k, top: (b.cy - b.h / 2) * k, width: b.w * k, height: b.h * k,
                transform: [{ rotate: `${b.angle}deg` }],
                borderWidth: picked ? 3 : 2,
                borderStyle: b.on ? 'solid' : 'dashed',
                borderColor: b.on ? (picked ? '#ffd166' : C.accent) : '#ffffff',
                backgroundColor: b.on ? 'transparent' : '#00000055',
              }}
            >
              <Text style={[s.tag, { backgroundColor: b.on ? C.accent : '#555' }]}>{b.on ? `${i + 1}` : 'skip'}</Text>
              {picked && <View style={s.handle} />}
            </View>
          );
        })}
      </View>
      <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center' }}>
        {chosen ? 'Drag to move · drag the corner dot to resize · tap again to keep or skip' : 'Tap a box to change it'}
      </Text>
      {chosen && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="outline" title="↺ 1°" onPress={() => update(chosen.id, { angle: Math.max(-45, chosen.angle - 1) })} style={{ flex: 1 }} />
          <Button kind="outline" title="↻ 1°" onPress={() => update(chosen.id, { angle: Math.min(45, chosen.angle + 1) })} style={{ flex: 1 }} />
          <Button kind="outline" title={chosen.on ? 'Skip' : 'Keep'} onPress={() => update(chosen.id, { on: !chosen.on })} style={{ flex: 1 }} />
          <Button kind="outline" title="Delete" onPress={removeBox} style={{ flex: 1 }} />
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button kind="outline" title="Add a box" onPress={() => add(false)} style={{ flex: 1 }} />
        <Button kind="outline" title="Whole page" onPress={() => add(true)} style={{ flex: 1 }} />
      </View>
      <Button title={keep ? `Save ${keep} item${keep === 1 ? '' : 's'}` : 'Nothing to save'} onPress={save} busy={saving} disabled={!keep || page.status === 'finding'} />
      <Button kind="quiet" title="Delete this page" onPress={removePage} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  tag: { position: 'absolute', left: -2, top: -2, color: '#fff', fontWeight: '900', fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderBottomRightRadius: 6, overflow: 'hidden' },
  handle: { position: 'absolute', right: -11, bottom: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffd166', borderWidth: 2, borderColor: '#fff' },
});
