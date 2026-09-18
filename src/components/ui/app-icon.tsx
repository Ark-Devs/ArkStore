import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { iconRadius, useColors } from '@/theme';

import { DotGrid } from './dots';
import { Txt } from './text';

/** Squircle app icon with a hairline edge; dot-grid monogram when the image is missing. */
export function AppIcon({ uri, name, size = 60 }: { uri: string | null | undefined; name: string; size?: number }) {
  const c = useColors();
  const [failed, setFailed] = useState(false);
  const r = iconRadius(size);
  const showImage = uri && !failed;

  return (
    <View
      accessibilityIgnoresInvertColors
      style={{
        width: size,
        height: size,
        borderRadius: r,
        overflow: 'hidden',
        backgroundColor: c.surface2,
        borderWidth: 1,
        borderColor: c.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
          accessibilityLabel={`${name} icon`}
        />
      ) : (
        <>
          <DotGrid gap={Math.max(6, size / 8)} size={Math.max(0.8, size / 60)} />
          <Txt variant="display" size={size * 0.46} color="text">
            {name.trim().charAt(0).toUpperCase()}
          </Txt>
        </>
      )}
    </View>
  );
}
