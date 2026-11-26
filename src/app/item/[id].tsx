import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, C } from '@/components/ui';
import { saveToPhotos, share } from '@/lib/export';
import { deleteItem, folder, newId, patchItem, useStore } from '@/lib/store';

/** One saved item: see it full size, add a note, turn it, save or share it. */
export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { items, albums, pages } = useStore();
  const item = items.find((i) => i.id === id);
  const [caption, setCaption] = useState(item?.caption ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (item) setCaption(item.caption); }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <View style={{ flex: 1, backgroundColor: C.paper }} />;
  const album = albums.find((a) => a.id === item.albumId);
  const page = pages.find((p) => p.id === item.pageId);
  const k = Math.min((width - 32) / item.w, (height * 0.55) / item.h);

  async function turn() {
    setBusy('turn');
    try {
      const img = await ImageManipulator.manipulate(item!.uri).rotate(90).renderAsync();
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      // A new file name, so the picture on screen refreshes.
      const dest = new File(folder(item!.albumId, 'items'), `${newId()}.jpg`);
      new File(out.uri).move(dest);
      try { new File(item!.uri).delete(); } catch {}
      patchItem(item!.id, { uri: dest.uri, w: out.width, h: out.height, inPhotos: false });
    } catch {
      Alert.alert('Couldn’t turn the photo', 'Please try again.');
    } finally {
      setBusy(null);
    }
  }
  async function toPhotos() {
    setBusy('photos');
    try {
      const r = await saveToPhotos([item!], album?.name ?? 'Scrapbook Scan', true);
      if (r.denied) Alert.alert('Photos access needed', 'Allow Scrapbook Scan to add photos in your phone’s settings.');
      else if (r.saved) Alert.alert('Saved to Photos', `Added to the “${album?.name ?? 'Scrapbook Scan'}” album.`);
      else Alert.alert('Couldn’t save', 'Please try again.');
    } finally {
      setBusy(null);
    }
  }
  function remove() {
    Alert.alert('Delete this item?', 'The photo is deleted from this app. A copy already saved to Photos stays there.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteItem(item!.id); router.back(); } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Image source={{ uri: item.uri }} style={{ width: item.w * k, height: item.h * k, alignSelf: 'center', borderRadius: 4 }} accessibilityLabel={item.caption || 'Scrapbook item'} />
        <Text style={{ color: C.muted, textAlign: 'center', fontSize: 12 }}>
          {`${item.w} × ${item.h} px${page ? ` · from page ${page.n}` : ''}${item.inPhotos ? ' · in Photos' : ''}`}
        </Text>
        <TextInput
          value={caption} onChangeText={setCaption} onEndEditing={() => patchItem(item.id, { caption })}
          placeholder="Add a note: who, where, when" placeholderTextColor={C.muted} multiline
          style={s.input} accessibilityLabel="Note about this item"
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Save to Photos" onPress={toPhotos} busy={busy === 'photos'} style={{ flex: 1 }} />
          <Button kind="outline" title="Share" onPress={async () => { if (!(await share(item.uri))) Alert.alert('Sharing isn’t available on this phone.'); }} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="outline" title="Turn 90°" onPress={turn} busy={busy === 'turn'} style={{ flex: 1 }} />
          {page && <Button kind="outline" title="Fix the crop" onPress={() => router.push(`/page/${page.id}`)} style={{ flex: 1 }} />}
        </View>
        <Button kind="quiet" title="Delete" onPress={remove} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1.5, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, color: C.ink, backgroundColor: '#fff', minHeight: 56 },
});
