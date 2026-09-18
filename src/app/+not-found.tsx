import { router } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/layout';
import { useColors } from '@/theme';

export default function NotFound() {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}>
      <EmptyState
        glyph="404"
        title="Nothing here"
        body="This page doesn't exist in ArkStore."
        action={<Button label="Go to Today" onPress={() => router.replace('/')} />}
      />
    </View>
  );
}
