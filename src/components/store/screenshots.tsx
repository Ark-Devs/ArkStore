import { Image } from 'expo-image';
import { X } from 'phosphor-react-native/src/icons/X';
import { useState } from 'react';
import { Modal, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { space, useColors } from '@/theme';

const HEIGHT = 400;
const RATIO = 0.48; // phone screenshots are roughly 9:19

export function ScreenshotStrip({ urls, appName }: { urls: string[]; appName: string }) {
  const c = useColors();
  const [open, setOpen] = useState<number | null>(null);
  if (urls.length === 0) return null;
  const width = Math.round(HEIGHT * RATIO);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={width + 12}
        contentContainerStyle={{ paddingHorizontal: space.gutter, gap: 12 }}
      >
        {urls.map((url, i) => (
          <Tap key={url} scale={0.98} onPress={() => setOpen(i)} accessibilityLabel={`${appName} screenshot ${i + 1}`}>
            <Image
              source={{ uri: url }}
              style={{
                width,
                height: HEIGHT,
                borderRadius: 20,
                backgroundColor: c.surface2,
                borderWidth: 1,
                borderColor: c.line,
              }}
              contentFit="cover"
              transition={200}
            />
          </Tap>
        ))}
      </ScrollView>
      <Viewer urls={urls} index={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Viewer({ urls, index, onClose }: { urls: string[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (index ?? 0) * width, y: 0 }}
        >
          {urls.map((url) => (
            <Image
              key={url}
              source={{ uri: url }}
              style={{ width, height }}
              contentFit="contain"
              accessibilityLabel="Screenshot"
            />
          ))}
        </ScrollView>
        <Tap
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close screenshots"
          style={{
            position: 'absolute',
            top: insets.top + 12,
            right: 16,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.14)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={20} color="#fff" />
        </Tap>
        <Txt variant="label" style={{ position: 'absolute', bottom: insets.bottom + 20, alignSelf: 'center', color: '#fff' }}>
          Swipe
        </Txt>
      </View>
    </Modal>
  );
}
