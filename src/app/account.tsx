import * as Application from 'expo-application';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Bell } from 'phosphor-react-native/src/icons/Bell';
import { CircleHalf } from 'phosphor-react-native/src/icons/CircleHalf';
import { Cpu } from 'phosphor-react-native/src/icons/Cpu';
import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { Moon } from 'phosphor-react-native/src/icons/Moon';
import { SignOut } from 'phosphor-react-native/src/icons/SignOut';
import { Sun } from 'phosphor-react-native/src/icons/Sun';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { InstallerList } from '@/components/store/installer-storage';
import { Chip, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { githubProfile, signInWithGitHub, signOut, useAuth } from '@/lib/auth';
import { abiLabel, deviceAbis } from '@/lib/device';
import { useInstalled } from '@/lib/stores/installed';
import { usePrefs, type InstallerCleanup, type ThemePref } from '@/lib/stores/prefs';
import { friendlyError } from '@/lib/supabase';
import { askForNotifications, notificationsAllowed } from '@/lib/updates';
import { radius, space, useColors } from '@/theme';

const CLEANUP: { key: InstallerCleanup; label: string }[] = [
  { key: 'ask', label: 'Ask me' },
  { key: 'delete', label: 'Delete it' },
  { key: 'keep', label: 'Keep it' },
];

const THEMES: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: CircleHalf },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'light', label: 'Light', icon: Sun },
];

function Row({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, gap: 12 }}>
        <Txt variant="body">{label}</Txt>
        {value ? (
          <Txt variant="mono" color="text2">
            {value}
          </Txt>
        ) : (
          children
        )}
      </View>
      <DotRule />
    </>
  );
}

export default function AccountScreen() {
  const c = useColors();
  const session = useAuth((s) => s.session);
  const profile = githubProfile(session);
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const notify = usePrefs((s) => s.notifyUpdates);
  const setNotify = usePrefs((s) => s.setNotifyUpdates);
  const installedCount = useInstalled((s) => Object.keys(s.apps).length);
  const cleanup = usePrefs((s) => s.installerCleanup);
  const setCleanup = usePrefs((s) => s.setInstallerCleanup);
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const abis = deviceAbis();

  useEffect(() => {
    notificationsAllowed().then(setAllowed);
  }, []);

  const toggleNotify = async (on: boolean) => {
    if (on && !allowed) {
      const ok = await askForNotifications();
      setAllowed(ok);
      if (!ok) return;
    }
    setNotify(on);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar close title="Account" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ margin: space.gutter, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
          <DotGrid gap={12} size={1.1} />
          <View style={{ padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {profile?.avatar ? (
              <Image source={{ uri: profile.avatar }} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surface2 }} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <GithubLogo size={30} color={c.text2} weight="light" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Txt variant="title" numberOfLines={1}>
                {profile ? profile.name || profile.login : 'Browsing as guest'}
              </Txt>
              <Txt variant="callout" color="text2">
                {profile ? `@${profile.login}` : "You don't need an account to install apps."}
              </Txt>
            </View>
          </View>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
            {session ? (
              <Button
                label="Sign out"
                variant="secondary"
                size="sm"
                icon={<SignOut size={14} color={c.text} />}
                onPress={async () => {
                  await signOut();
                  router.back();
                }}
              />
            ) : (
              <Button
                label="Sign in with GitHub"
                size="sm"
                loading={busy}
                icon={<GithubLogo size={14} color={c.onInvert} weight="fill" />}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await signInWithGitHub();
                  } catch (e) {
                    Alert.alert("Couldn't sign in", friendlyError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
          </View>
        </View>

        <SectionHeader title="Appearance" />
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: space.gutter }}>
          {THEMES.map((t) => {
            const active = theme === t.key;
            return (
              <Tap
                key={t.key}
                onPress={() => setTheme(t.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${t.label} theme`}
                style={{
                  flex: 1,
                  height: 84,
                  borderRadius: radius.tile,
                  backgroundColor: active ? c.invert : c.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <t.icon size={24} color={active ? c.onInvert : c.text} weight="light" />
                <Txt variant="label" color={active ? 'onInvert' : 'text'}>
                  {t.label}
                </Txt>
              </Tap>
            );
          })}
        </View>

        <View style={{ height: 24 }} />
        <SectionHeader title="Updates" />
        <View style={{ paddingHorizontal: space.gutter }}>
          {Platform.OS !== 'web' ? (
            <Row label="Notify me about updates">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Bell size={18} color={c.text2} />
                <Switch
                  value={notify && allowed}
                  onValueChange={toggleNotify}
                  trackColor={{ true: c.accent, false: c.surface3 }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Notify me about updates"
                />
              </View>
            </Row>
          ) : null}
          <Row label="Installed from ArkStore" value={String(installedCount)} />
        </View>

        {Platform.OS === 'android' ? (
          <>
            <View style={{ height: 24 }} />
            <SectionHeader title="Installer files" />
            <View style={{ paddingHorizontal: space.gutter, gap: 10, marginBottom: 10 }}>
              <Txt variant="callout" color="text2">
                After an app installs, its APK isn't needed anymore.
              </Txt>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {CLEANUP.map((opt) => (
                  <Chip
                    key={opt.key}
                    label={opt.label}
                    active={cleanup === opt.key}
                    onPress={() => setCleanup(opt.key)}
                  />
                ))}
              </View>
            </View>
            <InstallerList />
          </>
        ) : null}

        <View style={{ height: 24 }} />
        <SectionHeader title="This phone" />
        <View style={{ paddingHorizontal: space.gutter }}>
          <Row label="CPU">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Cpu size={16} color={c.text2} />
              <Txt variant="mono" color="text2">
                {abis.length ? abis.map(abiLabel).join(' / ') : 'not an Android phone'}
              </Txt>
            </View>
          </Row>
          <Txt variant="caption" color="text3" style={{ marginTop: 10 }}>
            ArkStore uses this to download the smallest build that runs on your phone.
          </Txt>
        </View>

        <View style={{ height: 24 }} />
        <SectionHeader title="About" />
        <View style={{ paddingHorizontal: space.gutter }}>
          <Row label="Version" value={Application.nativeApplicationVersion ?? '1.0.0'} />
          <Txt variant="caption" color="text3" style={{ marginTop: 10 }}>
            Every app here is built and shared by independent developers on GitHub. ArkStore downloads straight from
            their releases.
          </Txt>
        </View>
      </ScrollView>
    </View>
  );
}
