// Installing one app on an iPhone or iPad. iOS can't install from a browser, so this offers the
// ways that can: SideStore / AltStore (through ArkStore's source), TrollStore (straight from the
// IPA link), or the IPA itself for Feather and other signers. First-time setup is on /download.
import { router, useLocalSearchParams } from 'expo-router';
import { View, ScrollView } from 'react-native';

import { AddSourceButtons, openLink } from '@/components/ios/ios-guide';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { EmptyState, Skeleton } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useApp } from '@/lib/api';
import { fileSize, shortVersion } from '@/lib/format';
import { rankAssets } from '@/lib/github/assets';
import { openInApp, sideStoreInstallLink, trollStoreInstallLink } from '@/lib/ios';
import { catalogOS } from '@/lib/platform';
import { friendlyError } from '@/lib/supabase';
import { radius, space, useColors } from '@/theme';

function Way({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ borderRadius: radius.card, backgroundColor: c.surface, padding: 18, gap: 10 }}>
      <Txt variant="headline">{title}</Txt>
      <Txt variant="callout" color="text2">
        {body}
      </Txt>
      {children}
    </View>
  );
}

export default function IosInstallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { data: app, isLoading, error } = useApp(id);
  const onPhone = catalogOS() === 'ios';

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TopBar title="Install on iPhone" />
        <View style={{ padding: space.gutter, gap: 14 }}>
          <Skeleton style={{ height: 80 }} />
          <Skeleton style={{ height: 160 }} />
        </View>
      </View>
    );
  }

  const ipas = app ? rankAssets(app.assets, { os: 'ios' }) : [];
  const ipa = ipas[0];
  // TrollStore builds (.tipa) keep entitlements a normal IPA can't use; prefer them there.
  const troll = ipas.find((f) => /\.tipa$/i.test(f.name)) ?? ipa;

  if (error || !app || !ipa) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TopBar title="Install on iPhone" />
        <EmptyState
          glyph="iOS"
          title={app ? `${app.name} has no iOS build` : 'App not found'}
          body={error ? friendlyError(error) : 'Its newest GitHub release has no IPA file.'}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar title="Install on iPhone" />
      <ScrollView contentContainerStyle={{ padding: space.gutter, paddingBottom: 60, gap: 14, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <AppIcon uri={app.icon_url} name={app.name} size={64} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="title" numberOfLines={2}>
              {app.name}
            </Txt>
            <Txt variant="mono" color="text3" style={{ fontSize: 11 }}>
              {[shortVersion(app.latest_version), ipa.name, fileSize(ipa.size)].filter(Boolean).join('  ·  ')}
            </Txt>
          </View>
        </View>
        <DotRule />

        <Way
          title="SideStore"
          body={`Installs ${app.name} in SideStore with one tap. SideStore asks you to confirm, then keeps it signed.`}
        >
          {onPhone ? (
            <Button label="Install with SideStore" variant="accent" onPress={() => openInApp(sideStoreInstallLink(ipa.url))} />
          ) : (
            <Txt variant="caption" color="text3">
              Open this page on your iPhone to install with SideStore.
            </Txt>
          )}
        </Way>

        <Way
          title="Get updates too"
          body={`Add ArkStore's source to SideStore or AltStore once: ${app.name} and every other iOS app here show up in Browse, and new releases show up as updates.`}
        >
          <AddSourceButtons />
        </Way>

        <Way title="TrollStore" body="If your iPhone has TrollStore, it installs the app permanently: no refreshing and no app limit.">
          {onPhone ? (
            <Button label="Install with TrollStore" variant="secondary" onPress={() => openInApp(trollStoreInstallLink(troll.url))} />
          ) : (
            <Txt variant="caption" color="text3">
              Open this page on your iPhone to install with TrollStore.
            </Txt>
          )}
        </Way>

        <Way title="Download the IPA" body="For Feather with your own certificate, or any other signer.">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {ipas.map((f) => (
              <Button key={f.name} label={`${f.name}  ·  ${fileSize(f.size)}`} variant="secondary" size="sm" onPress={() => openLink(f.url)} />
            ))}
          </View>
        </Way>

        <View style={{ alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <Txt variant="callout" color="text2" align="center">
            First time? SideStore needs a one-time setup with a computer.
          </Txt>
          <Button label="Read the setup guide" variant="ghost" onPress={() => router.push('/download')} />
        </View>
      </ScrollView>
    </View>
  );
}
