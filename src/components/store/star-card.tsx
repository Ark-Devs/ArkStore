import { Image } from 'expo-image';
import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { Linking, View } from 'react-native';

import { DotGrid } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { compactNumber } from '@/lib/format';
import { profileUrl, repoUrl } from '@/lib/github/repo';
import { radius, space, useColors } from '@/theme';

/** Credit where it's due: who built this, and one tap to thank them with a star. */
export function StarCard({
  name,
  repo,
  developer,
  avatar,
  stars,
}: {
  name: string;
  repo: string;
  developer: string;
  avatar: string | null;
  stars: number;
}) {
  const c = useColors();
  return (
    <View style={{ marginHorizontal: space.gutter, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <DotGrid gap={14} size={1.2} />
      <View style={{ padding: 20, gap: 12 }}>
        <Tap
          onPress={() => Linking.openURL(profileUrl(developer))}
          accessibilityRole="link"
          accessibilityLabel={`${developer} on GitHub`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' }}
        >
          {avatar ? (
            <Image source={{ uri: avatar }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.surface2 }} />
          ) : null}
          <Txt variant="label" color="text2">
            Made by @{developer}
          </Txt>
        </Tap>

        <Txt variant="title">Enjoying {name}?</Txt>
        <Txt variant="body" color="text2">
          People like @{developer} put apps like this out for free, most of them without a single ad, just to make
          your phone a little better. A star on GitHub costs you nothing and tells them it was worth the late nights.
        </Txt>

        <Tap
          onPress={() => Linking.openURL(repoUrl(repo))}
          accessibilityRole="link"
          accessibilityLabel={`Star ${name} on GitHub`}
          style={{
            marginTop: 4,
            height: 50,
            borderRadius: radius.pill,
            backgroundColor: c.invert,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            gap: 10,
          }}
        >
          <GithubLogo size={22} color={c.onInvert} weight="fill" />
          <Txt variant="headline" color="onInvert" style={{ flex: 1 }}>
            Star on GitHub
          </Txt>
          <Star size={16} color={c.onInvert} weight="fill" />
          <Txt variant="number" size={16} color="onInvert">
            {compactNumber(stars)}
          </Txt>
        </Tap>
      </View>
    </View>
  );
}
