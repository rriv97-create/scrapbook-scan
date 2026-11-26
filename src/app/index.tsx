import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C, Card, TITLE } from '@/components/ui';
import { addAlbum, useStore } from '@/lib/store';

/** Home: your scrapbooks, and starting a new one. */
export default function Home() {
  const insets = useSafeAreaInsets();
  const { albums, pages, items } = useStore();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  function create() {
    const a = addAlbum(name);
    setNaming(false); setName('');
    router.push({ pathname: '/scan', params: { album: a.id } });
  }

  const header = (
    <View style={{ gap: 14, marginBottom: 8 }}>
      <Text style={{ color: C.muted, lineHeight: 21 }}>
        Turn the pages of a scrapbook under your phone. Each page is captured hands-free, and every photo,
        ticket and keepsake on it is cut out and straightened as its own picture.
      </Text>
      {naming ? (
        <Card>
          <Text style={{ fontWeight: '800', color: C.ink }}>Name this scrapbook</Text>
          <TextInput
            value={name} onChangeText={setName} autoFocus placeholder="Grandma’s 1970s album"
            placeholderTextColor={C.muted} returnKeyType="go" onSubmitEditing={create}
            style={s.input} accessibilityLabel="Scrapbook name"
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="outline" title="Cancel" onPress={() => setNaming(false)} style={{ flex: 1 }} />
            <Button title="Start scanning" onPress={create} style={{ flex: 2 }} />
          </View>
        </Card>
      ) : (
        <Button title="New scrapbook" onPress={() => setNaming(true)} />
      )}
      {!!albums.length && <Text style={[TITLE, { fontSize: 17, marginTop: 6 }]}>Your scrapbooks</Text>}
    </View>
  );

  return (
    <FlatList
      data={albums}
      keyExtractor={(a) => a.id}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 10 }}
      ListHeaderComponent={header}
      ListFooterComponent={
        <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 18, lineHeight: 18 }}>
          Free, no account. Your photos stay on this phone until you save or share them.
        </Text>
      }
      renderItem={({ item: a }) => {
        const mine = items.filter((i) => i.albumId === a.id);
        const ps = pages.filter((p) => p.albumId === a.id);
        const toCheck = ps.filter((p) => p.status === 'check' || p.status === 'ready').length;
        const cover = mine[mine.length - 1]?.uri ?? ps[ps.length - 1]?.uri;
        return (
          <Pressable onPress={() => router.push(`/album/${a.id}`)} accessibilityRole="button" style={({ pressed }) => [s.row, pressed && { opacity: 0.8 }]}>
            {cover ? <Image source={{ uri: cover }} style={s.thumb} /> : <View style={[s.thumb, { backgroundColor: C.accentSoft }]} />}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '800', color: C.ink, fontSize: 16 }} numberOfLines={1}>{a.name}</Text>
              <Text style={{ color: C.muted }}>
                {`${ps.length} page${ps.length === 1 ? '' : 's'} · ${mine.length} item${mine.length === 1 ? '' : 's'}`}
              </Text>
              {!!toCheck && <Text style={{ color: C.warn, fontWeight: '700' }}>{`${toCheck} to check`}</Text>}
            </View>
            <Text style={{ color: C.muted, fontSize: 20 }}>›</Text>
          </Pressable>
        );
      }}
    />
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1.5, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, color: C.ink, backgroundColor: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 10 },
  thumb: { width: 64, height: 64, borderRadius: 8 },
});
