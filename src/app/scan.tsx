import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, Linking, Pressable, StyleSheet, Text, Vibration, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C } from '@/components/ui';
import { checkPhoto, loadSettings, savePage, saveSettings, type Settings } from '@/lib/extract';
import { frameFrom, judge, TUNING, type Frame, type Seen, type Watch } from '@/lib/frame';
import type { Crop } from '@/lib/geometry';
import { readPixels } from '@/lib/pixels';
import { useStore } from '@/lib/store';
import { levelFor, shakeStep, tiltFrom, type Accel, type Edge, type Level, type Tilt } from '@/lib/tilt';

// The scanning screen, adapted from the catalog mode kit: a guide frame, the tilt guide, and a
// capture loop that takes each new page hands-free once it's square, steady and sharp.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FRAME_WIDTH = 24; // tiny copy used to compare frames

/** Biggest picture size the camera offers (or about 2400 px on the long side for "faster"). */
function pickSize(sizes: string[], best: boolean): string | undefined {
  const parsed = sizes
    .map((s) => { const [w, h] = s.split('x').map(Number); return { s, long: Math.max(w || 0, h || 0) }; })
    .filter((x) => x.long > 0)
    .sort((a, b) => a.long - b.long);
  if (!parsed.length) return undefined;
  if (best) return parsed[parsed.length - 1].s;
  return (parsed.find((x) => x.long >= 2400) ?? parsed[parsed.length - 1]).s;
}

type Box = { x: number; y: number; width: number; height: number };
const LEVEL_COLOR: Record<Level, string> = { red: '#ff453a', amber: '#ffb020', green: '#30d158' };
const EDGES: Edge[] = ['left', 'right', 'top', 'bottom'];
const ARROW: Record<Edge, string> = { left: '◀', right: '▶', top: '▲', bottom: '▼' };
const SHAPES: { key: Settings['shape']; label: string; aspect: number; width: string }[] = [
  { key: 'square', label: 'Square page', aspect: 1, width: '88%' },
  { key: 'portrait', label: 'Tall page', aspect: 8.5 / 11, width: '80%' },
  { key: 'landscape', label: 'Wide / two pages', aspect: 1.45, width: '94%' },
];

type Guide = { level: Level | 'idle'; edges: Edge[]; text: string };
function guideFor(o: { paused: boolean; captured: boolean; tilt: Tilt | null; shake: number; seen: Seen | ''; hint: string | null }): Guide {
  if (o.paused) return { level: 'idle', edges: [], text: 'Paused' };
  if (o.captured) return { level: 'green', edges: [], text: 'Got it. Turn the page' };
  const sensor = o.tilt ? levelFor(o.tilt, o.shake) : null;
  const edges = o.tilt && sensor !== 'green' ? EDGES.filter((e) => o.tilt!.edges[e]) : [];
  if (o.tilt?.mode === 'unknown') return { level: 'red', edges: [], text: 'Hold the phone flat over the page' };
  if (sensor && sensor !== 'green') return { level: sensor, edges, text: edges.length ? 'Tilt toward the glowing edge' : 'Hold steady' };
  if (o.hint) return { level: 'amber', edges: [], text: o.hint };
  if (o.seen === 'already captured' || o.seen === 'just captured') return { level: 'idle', edges: [], text: 'Turn to the next page' };
  if (o.seen === 'nothing there' || o.seen === 'blank page' || !o.seen) return { level: sensor ?? 'amber', edges: [], text: 'Fit the page inside the frame' };
  if (o.seen === 'moving') return { level: 'amber', edges: [], text: 'Hold steady' };
  return { level: 'green', edges: [], text: 'Perfect, hold it there' };
}

/** Where the on-screen frame falls in the photo (the preview fills the screen and trims the photo). */
function cropFor(pic: { width: number; height: number }, box: Box, screen: { width: number; height: number }, margin = 0.03): Crop | undefined {
  if (!pic.width || !pic.height || !box.width || !screen.width) return undefined;
  const scale = Math.max(screen.width / pic.width, screen.height / pic.height);
  const offX = (pic.width * scale - screen.width) / 2;
  const offY = (pic.height * scale - screen.height) / 2;
  let x = (box.x + offX) / scale, y = (box.y + offY) / scale;
  let w = box.width / scale, h = box.height / scale;
  x -= w * margin; y -= h * margin; w *= 1 + 2 * margin; h *= 1 + 2 * margin;
  x = Math.max(0, x); y = Math.max(0, y);
  w = Math.min(pic.width - x, w); h = Math.min(pic.height - y, h);
  if (w < 20 || h < 20) return undefined;
  return { originX: Math.round(x), originY: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

async function readFrame(uri: string, crop?: Crop): Promise<Frame | null> {
  const px = await readPixels(uri, FRAME_WIDTH, crop);
  return px ? frameFrom(px.width, px.height, px.data) : null;
}

export default function Scan() {
  const { album } = useLocalSearchParams<{ album: string }>();
  const insets = useSafeAreaInsets();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const { albums, pages, items } = useStore();
  const albumName = albums.find((a) => a.id === album)?.name ?? 'Scrapbook';

  const [settings, setSettings] = useState<Settings | null>(null);
  const [focused, setFocused] = useState(false);
  const [torch, setTorch] = useState(false); // off: the light glares on glossy photos
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [ready, setReady] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seen, setSeen] = useState<Seen | ''>('');
  const [captured, setCaptured] = useState(false);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const tiltRef = useRef<Tilt | null>(null);
  const shakeRef = useRef(0);
  const [sense, setSense] = useState<{ tilt: Tilt | null; shake: number }>({ tilt: null, shake: 0 });
  const flashAnim = useRef(new Animated.Value(0)).current;
  const popAnim = useRef(new Animated.Value(1)).current;

  const recent = useRef<Frame[]>([]);
  const lastAt = useRef(0);
  const screen = useWindowDimensions();
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  const guideRef = useRef<View>(null);
  const guideBox = useRef<Box | null>(null);
  const measureGuide = () => guideRef.current?.measureInWindow((x, y, width, height) => { guideBox.current = { x, y, width, height }; });
  const squareRef = useRef(true);
  const captureNow = useRef(false);
  const busy = useRef(false);

  useEffect(() => { loadSettings().then(setSettings); }, []);
  useFocusEffect(useCallback(() => {
    setFocused(true); setSessionIds([]); setNotice(null); setHint(null); setPaused(false);
    recent.current = []; lastAt.current = 0;
    return () => { setFocused(false); setReady(false); };
  }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setAppActive(st === 'active'));
    return () => sub.remove();
  }, []);

  async function onReady() {
    try { const list = await cam.current?.getAvailablePictureSizesAsync(); if (list?.length) setSizes(list); } catch {}
    setReady(true);
  }

  const live = focused && appActive && ready && !paused && !!perm?.granted && !!album;

  // Accelerometer: which way to tilt, and whether the hand is steady.
  useEffect(() => {
    if (!live) return;
    let sub: { remove: () => void } | null = null;
    let prev: Accel | null = null;
    let lastKey = '';
    let on = true;
    Accelerometer.isAvailableAsync().then((ok) => {
      if (!ok || !on) { squareRef.current = true; return; }
      Accelerometer.setUpdateInterval(80);
      sub = Accelerometer.addListener((a) => {
        shakeRef.current = shakeStep(prev, a, shakeRef.current);
        prev = a;
        const t = tiltFrom(a);
        tiltRef.current = t;
        const level = levelFor(t, shakeRef.current);
        squareRef.current = level === 'green';
        const key = `${t.mode}|${level}|${EDGES.filter((e) => t.edges[e]).join(',')}`;
        if (key !== lastKey) { lastKey = key; setSense({ tilt: t, shake: shakeRef.current }); }
      });
    }).catch(() => { squareRef.current = true; });
    return () => { on = false; sub?.remove(); tiltRef.current = null; setSense({ tilt: null, shake: 0 }); };
  }, [live]);

  function celebrate() {
    setCaptured(true);
    setTimeout(() => setCaptured(false), 1100);
    flashAnim.setValue(0); popAnim.setValue(1);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(popAnim, { toValue: 1.03, duration: 110, useNativeDriver: true }),
        Animated.spring(popAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]),
    ]).start();
  }

  // The capture loop: take a quiet frame, check it on the phone, keep it if it's a new, steady page.
  useEffect(() => {
    if (!live || !album) return;
    let on = true;
    const watch: Watch = { prev: null, recent: recent.current, lastAt: lastAt.current };
    (async () => {
      while (on) {
        let uri: string | null = null;
        let crop: Crop | undefined;
        try {
          // Every frame is full quality, so the one that passes all checks is the one kept.
          const pic = await cam.current?.takePictureAsync({ quality: 1, shutterSound: false });
          uri = pic?.uri ?? null;
          if (pic && guideBox.current) crop = cropFor(pic, guideBox.current, screenRef.current);
        } catch {
          await wait(400);
          continue;
        }
        if (!uri) { await wait(400); continue; }
        try {
          const f = on ? await readFrame(uri, crop) : null;
          if (f) {
            const j = judge(watch, f);
            watch.prev = f;
            setSeen(j.why);
            const forced = captureNow.current;
            captureNow.current = false;
            if (on && ((j.action === 'capture' && squareRef.current) || forced) && !busy.current) {
              busy.current = true;
              try {
                const check = forced ? { ok: true as const } : await checkPhoto(uri, crop);
                if (check.ok) {
                  recent.current = [f, ...recent.current].slice(0, TUNING.REMEMBER);
                  watch.recent = recent.current;
                  lastAt.current = watch.lastAt = Date.now();
                  const page = await savePage(album, uri, crop);
                  uri = null; // moved into the scrapbook, don't delete
                  setSessionIds((ids) => [page.id, ...ids]);
                  setHint(null);
                  celebrate();
                  try { Vibration.vibrate(35); } catch {}
                } else {
                  setHint(check.message);
                  setTimeout(() => setHint(null), 2500);
                }
              } finally {
                busy.current = false;
              }
            }
          }
        } catch {
          // A frame that can't be read is skipped.
        } finally {
          if (uri) { try { new File(uri).delete(); } catch {} }
        }
        await wait(120);
      }
    })();
    return () => { on = false; };
  }, [live, album]);

  function done() {
    router.replace(`/album/${album}`);
  }

  if (!perm) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!perm.granted) {
    return (
      <View style={[s.center, { backgroundColor: C.paper, paddingTop: insets.top + 24 }]}>
        <Text style={{ color: C.ink, fontSize: 20, fontWeight: '800', textAlign: 'center' }}>Camera access needed</Text>
        <Text style={{ color: C.muted, textAlign: 'center', lineHeight: 20 }}>
          Scrapbook Scan watches for each page as you turn them. Photos stay on your phone.
        </Text>
        {perm.canAskAgain
          ? <Button title="Allow camera" onPress={requestPerm} />
          : <Button title="Open Settings" onPress={() => Linking.openSettings()} />}
        <Button kind="outline" title="Back" onPress={() => router.back()} />
      </View>
    );
  }

  const shape = SHAPES.find((x) => x.key === settings?.shape) ?? SHAPES[0];
  const session = sessionIds.map((id) => pages.find((p) => p.id === id)).filter(Boolean) as typeof pages;
  const found = items.filter((i) => sessionIds.includes(i.pageId)).length;
  const toCheck = session.filter((p) => p.status === 'check').length;
  const latest = session[0];
  const guide = guideFor({ paused, captured, tilt: sense.tilt, shake: sense.shake, seen, hint });
  const frameColor = guide.level === 'idle' ? (paused ? '#ffffff55' : '#ffffffcc') : LEVEL_COLOR[guide.level];
  const pictureSize = sizes.length ? pickSize(sizes, settings?.best ?? true) : undefined;

  function nextShape() {
    if (!settings) return;
    const i = SHAPES.findIndex((x) => x.key === settings.shape);
    const next = { ...settings, shape: SHAPES[(i + 1) % SHAPES.length].key };
    setSettings(next); saveSettings(next);
    recent.current = []; // a new frame shape changes every comparison
    setTimeout(measureGuide, 50);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {focused && (
        <CameraView
          ref={cam}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          enableTorch={torch}
          pictureSize={pictureSize}
          onCameraReady={onReady}
          onMountError={(e) => setNotice(`The camera didn’t start: ${e.message}`)}
        />
      )}

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={done} accessibilityRole="button" hitSlop={10} style={[s.pill, { backgroundColor: C.accent }]}>
          <Text style={{ color: '#fff', fontWeight: '900' }}>Done</Text>
        </Pressable>
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          <Text style={[s.white, { fontSize: 16, fontWeight: '800' }]} numberOfLines={1}>{albumName}</Text>
          <Text style={[s.white, { fontSize: 12, opacity: 0.85 }]}>
            {`${session.length} page${session.length === 1 ? '' : 's'} · ${found} item${found === 1 ? '' : 's'}${toCheck ? ` · ${toCheck} to check` : ''}`}
          </Text>
        </View>
      </View>

      {/* Page guide: red/amber while lining up (the glowing edge says which way to tilt), green
          when square and steady, which is when it captures. Tap it to capture right away. */}
      <View pointerEvents="box-none" style={s.guideWrap}>
        <View ref={guideRef} onLayout={measureGuide} style={{ width: shape.width as `${number}%`, aspectRatio: shape.aspect, maxHeight: screen.height * 0.58 }}>
          {guide.edges.map((e) => (
            <View key={e} pointerEvents="none" style={[s.edge, edgeAt[e]]}>
              <View style={[s.bar, e === 'left' || e === 'right' ? s.barTall : s.barWide, { backgroundColor: frameColor }]} />
              <Text style={[s.arrow, { color: frameColor }]}>{ARROW[e]}</Text>
            </View>
          ))}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.frame, { borderColor: frameColor, transform: [{ scale: popAnim }] }]} />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.frame, s.flash, { opacity: flashAnim, transform: [{ scale: popAnim }] }]} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => { captureNow.current = true; }}
            accessibilityRole="button"
            accessibilityLabel="Capture this page now"
            accessibilityHint={guide.text}
          />
        </View>
        <Text pointerEvents="none" accessibilityLiveRegion="polite"
          style={[s.white, s.guideText, { color: guide.level === 'idle' ? '#fff' : frameColor }]}>
          {guide.text}
        </Text>
      </View>

      <View style={[s.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {!!notice && <Text style={{ color: C.warn, fontWeight: '700' }}>{notice}</Text>}
        {latest ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Image source={{ uri: latest.uri }} style={s.thumb} />
            <Text style={{ flex: 1, color: latest.status === 'check' ? C.warn : C.ink, fontWeight: '600' }} numberOfLines={2}>
              {latest.status === 'finding' ? `Page ${latest.n}: finding photos…`
                : latest.status === 'check' ? `Page ${latest.n}: ${latest.why ?? 'check this one later'}`
                : `Page ${latest.n}: ${items.filter((i) => i.pageId === latest.id).length} items saved`}
            </Text>
          </View>
        ) : (
          <Text style={{ color: C.muted, lineHeight: 19 }}>
            Lay the scrapbook flat in even light and hold the phone over it. Each new page is captured on its own;
            just turn the page when you see the flash.
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="outline" title={paused ? 'Resume' : 'Pause'} onPress={() => setPaused((v) => !v)} style={{ flex: 1 }} />
          <Button kind="outline" title={shape.label} onPress={nextShape} style={{ flex: 1.4 }} />
          <Button kind={torch ? 'solid' : 'outline'} title={torch ? 'Light off' : 'Light'} onPress={() => setTorch((v) => !v)} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}

const edgeAt = StyleSheet.create({
  left: { left: -30, top: '30%', bottom: '30%', width: 24, flexDirection: 'row-reverse' },
  right: { right: -30, top: '30%', bottom: '30%', width: 24, flexDirection: 'row' },
  top: { top: -30, left: '25%', right: '25%', height: 24, flexDirection: 'column-reverse' },
  bottom: { bottom: -30, left: '25%', right: '25%', height: 24, flexDirection: 'column' },
});

const s = StyleSheet.create({
  center: { flex: 1, padding: 24, gap: 14, justifyContent: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99 },
  white: { color: '#fff', textShadowColor: '#000', textShadowRadius: 3 },
  guideWrap: { position: 'absolute', left: 0, right: 0, top: '11%', alignItems: 'center' },
  frame: { borderWidth: 4, borderRadius: 10 },
  flash: { borderColor: '#fff', backgroundColor: '#ffffff26' },
  guideText: { marginTop: 12, fontWeight: '800', textAlign: 'center', paddingHorizontal: 24 },
  edge: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  bar: { borderRadius: 3, opacity: 0.9 },
  barTall: { width: 5, alignSelf: 'stretch' },
  barWide: { height: 5, alignSelf: 'stretch' },
  arrow: { fontSize: 14, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 3 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14, gap: 10 },
  thumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: C.line },
});
