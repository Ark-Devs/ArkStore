import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { DotLoader } from '@/components/ui/dots';
import { EmptyState } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { completeSignIn, useAuth } from '@/lib/auth';
import { useColors } from '@/theme';

/** Landing page for the GitHub OAuth redirect (web, and deep links on Android). */
export default function AuthCallback() {
  const c = useColors();
  const session = useAuth((s) => s.session);
  const url = Linking.useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url) completeSignIn(url).catch((e) => setError(e.message));
  }, [url]);

  useEffect(() => {
    if (session) router.replace('/studio');
  }, [session]);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center' }}>
        <EmptyState
          glyph="!?"
          title="Sign-in didn't finish"
          body={error}
          action={<Button label="Back to Studio" onPress={() => router.replace('/studio')} />}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <DotLoader size={7} color={c.accent} />
      <Txt variant="label" color="text2">
        Signing you in
      </Txt>
    </View>
  );
}
