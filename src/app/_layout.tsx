import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { C } from '@/components/ui';
import { loadSettings, startFinding } from '@/lib/extract';
import { load } from '@/lib/store';

export default function Root() {
  // Pick up any page that was still being read when the app last closed.
  useEffect(() => { load().then(loadSettings).then(startFinding); }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.paper },
          headerShadowVisible: false,
          headerTintColor: C.ink,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: C.paper },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Scrapbook Scan' }} />
        <Stack.Screen name="scan" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="album/[id]" options={{ title: '' }} />
        <Stack.Screen name="page/[id]" options={{ title: 'Check the page' }} />
        <Stack.Screen name="item/[id]" options={{ title: '' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
