import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C, Card, Chip, TITLE } from '@/components/ui';
import { itemsInOrder, saveToPhotos } from '@/lib/export';
import { loadSettings, saveSettings, type Settings } from '@/lib/extract';
import { deleteAlbum, renameAlbum, useStore } from '@/lib/store';

/** One scrapbook: the items cut out of it, its pages, saving everything to Photos. */
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const store = useStore();
  const album = store.albums.find((a) => a.id === id);
  const [tab, setTab] = useState<'items' | 'pages'>('items');
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState(album?.name ?? '');
  useEffect(() => { loadSettings().then(setSettings); }, []);
  useEffect(() => { if (album) setName(album.name); }, [album?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!album) return <View style={{ flex: 1, backgroundColor: C.paper }} />;
  const items = itemsInOrder(album.id);
  const pages = store.pages.filter((p) => p.albumId === album.id).sort((a, b) => a.n - b.n);
  const toCheck = pages.filter((p) => p.status === 'check' || p.status === 'ready');
  const finding = pages.filter((p) => p.status === 'finding').length;
  const unsaved = items.filter((i) => !i.inPhotos).length;
  const cols = 3, gap = 6, size = (width - 32 - gap * (cols - 1)) / cols;

  async function saveAll() {
    setBusy(true);
    try {
      const r = await saveToPhotos(items, album!.name);
      if (r.denied) Alert.alert('Photos access needed', 'Allow Scrapbook Scan to add photos in your phone’s settings, then try again.');
      else if (r.failed) Alert.alert('Saved with problems', `${r.saved} saved to Photos, ${r.failed} couldn’t be saved.`);
      else Alert.alert('Saved to Photos', `${r.saved} photo${r.saved === 1 ? '' : 's'} added to the “${album!.name}” album.`);
    } finally {
      setBusy(false);
    }
  }
  function setOpt(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next); saveSettings(next);
  }
  function remove() {
    Alert.alert(`Delete “${album!.name}”?`, 'All its pages and items are deleted from this app. Anything already saved to Photos stays there.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteAlbum(album!.id); router.back(); } },
    ]);
  }

  const header = (
    <View style={{ gap: 12, marginBottom: 10 }}>
      <Text style={TITLE} numberOfLines={2}>{album.name}</Text>
      <Text style={{ color: C.muted }}>
        {`${pages.length} page${pages.length === 1 ? '' : 's'} · ${items.length} item${items.length === 1 ? '' : 's'}${finding ? ` · finding photos on ${finding}…` : ''}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Scan pages" onPress={() => router.push({ pathname: '/scan', params: { album: album.id } })} style={{ flex: 1 }} />
        <Button kind="outline" title={unsaved ? `Save ${unsaved} to Photos` : 'All in Photos'} onPress={saveAll} busy={busy} disabled={!unsaved} style={{ flex: 1 }} />
      </View>
      {!!toCheck.length && (
        <Pressable onPress={() => router.push(`/page/${toCheck[0].id}`)} accessibilityRole="button">
          <Card style={{ borderColor: C.warn, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: C.warn, fontWeight: '800' }}>
              {`${toCheck.length} page${toCheck.length === 1 ? '' : 's'} to check. Tap to look at the boxes and save.`}
            </Text>
            <Text style={{ color: C.warn, fontSize: 20 }}>›</Text>
          </Card>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Chip label={`Items (${items.length})`} on={tab === 'items'} onPress={() => setTab('items')} />
        <Chip label={`Pages (${pages.length})`} on={tab === 'pages'} onPress={() => setTab('pages')} />
        <View style={{ flex: 1 }} />
        <Chip label="Options" on={opts} onPress={() => setOpts((v) => !v)} />
      </View>
      {opts && settings && (
        <Card>
          <TextInput value={name} onChangeText={setName} onEndEditing={() => renameAlbum(album.id, name)}
            style={s.input} accessibilityLabel="Scrapbook name" />
          <Toggle label="Cut out items as soon as they’re found clearly" value={settings.autoCut} onChange={(v) => setOpt({ autoCut: v })} />
          <Toggle label="Also keep each whole page as a photo" value={settings.keepPages} onChange={(v) => setOpt({ keepPages: v })} />
          <Toggle label="Best quality (biggest camera size, a little slower)" value={settings.best} onChange={(v) => setOpt({ best: v })} />
          <Button kind="quiet" title="Delete this scrapbook" onPress={remove} />
        </Card>
      )}
    </View>
  );

  if (tab === 'pages') {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <FlatList
          data={pages}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 8 }}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={{ color: C.muted }}>No pages yet. Tap Scan pages to start.</Text>}
          renderItem={({ item: p }) => {
            const n = store.items.filter((i) => i.pageId === p.id).length;
            return (
              <Pressable onPress={() => router.push(`/page/${p.id}`)} accessibilityRole="button" style={s.row}>
                <Image source={{ uri: p.uri }} style={s.pageThumb} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontWeight: '800', color: C.ink }}>{`Page ${p.n}`}</Text>
                  <Text style={{ color: p.status === 'check' ? C.warn : C.muted }} numberOfLines={2}>
                    {p.status === 'finding' ? 'Finding photos…' : p.status === 'check' ? p.why ?? 'Check the boxes' : p.status === 'ready' ? `${p.boxes.length} found, not cut yet` : `${n} item${n === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <Text style={{ color: C.muted, fontSize: 20 }}>›</Text>
              </Pressable>
            );
          }}
        />
      </>
    );
  }
  return (
    <FlatList
      data={items}
      key="grid"
      numColumns={cols}
      keyExtractor={(i) => i.id}
      columnWrapperStyle={{ gap }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap }}
      ListHeaderComponent={header}
      ListEmptyComponent={<Text style={{ color: C.muted }}>{pages.length ? 'Items appear here as pages are read.' : 'No pages yet. Tap Scan pages to start.'}</Text>}
      renderItem={({ item: i }) => (
        <Pressable onPress={() => router.push(`/item/${i.id}`)} accessibilityRole="imagebutton" accessibilityLabel={i.caption || 'Scrapbook item'}>
          <Image source={{ uri: i.uri }} style={{ width: size, height: size, borderRadius: 6, backgroundColor: C.line }} resizeMode="cover" />
          {i.inPhotos && <Text style={s.saved}>✓</Text>}
        </Pressable>
      )}
    />
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ flex: 1, color: C.ink }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.accent }} accessibilityLabel={label} />
    </View>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1.5, borderColor: C.line, borderRadius: 10, padding: 10, fontSize: 16, color: C.ink, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 8 },
  pageThumb: { width: 72, height: 72, borderRadius: 6, backgroundColor: C.line },
  saved: { position: 'absolute', right: 4, bottom: 4, color: '#fff', backgroundColor: C.good, borderRadius: 99, width: 20, height: 20, textAlign: 'center', fontWeight: '900', overflow: 'hidden', fontSize: 12, lineHeight: 20 },
});
