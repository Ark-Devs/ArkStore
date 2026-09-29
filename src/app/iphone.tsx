// /iphone: ArkStore on a computer installs iPhone apps itself, signed with the person's own
// free Apple Account: plug in the iPhone, sign in once, install. No SideStore, AltServer or
// iloader. It installs ArkStore first (or the app in ?app=<id>), then keeps every app it
// installed signed, re-signing them in the background while the iPhone is connected. The work
// happens in desktop/iphone.cjs (computer) or src/lib/ios-sideload.ts (the iPhone itself), both
// on the installer in sideload/ (Rust). Elsewhere this page explains where to get it.
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle } from 'phosphor-react-native/src/icons/CheckCircle';
import { CircleIcon as Circle } from 'phosphor-react-native/src/icons/Circle';
import { DeviceMobile } from 'phosphor-react-native/src/icons/DeviceMobile';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { CodeBlock } from '@/components/agents/code-block';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useApp } from '@/lib/api';
import { desktop, type IPhoneApp, type IPhoneDevice, type IPhoneEvent } from '@/lib/desktop';
import { rankAssets } from '@/lib/github/assets';
import { IOS_LINKS, openInApp } from '@/lib/ios';
import { iphoneLocal } from '@/lib/ios-sideload';
import { useLatestArkStore } from '@/lib/self-update';
import { radius, space, useColors } from '@/theme';

// On a computer the desktop app's installer; on the iPhone, ArkStore's own (src/lib/ios-sideload.ts).
const bridge = desktop?.iphone ?? iphoneLocal;
const onPhone = !desktop?.iphone && Boolean(iphoneLocal);

const STAGE: Record<string, string> = {
  download: 'Downloading',
  signin: 'Signing in to Apple',
  sign: 'Signing with your Apple Account',
  transfer: 'Copying to the iPhone',
  pair: 'Setting up renewing on the iPhone',
  done: 'Installed',
};

const DAY = 24 * 60 * 60 * 1000;

function Step({ done, active, title, children }: { done: boolean; active: boolean; title: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View
      style={{
        borderRadius: radius.card,
        backgroundColor: c.surface,
        padding: 18,
        gap: 12,
        opacity: active || done ? 1 : 0.5,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {done ? <CheckCircle size={22} color={c.accent} weight="fill" /> : <Circle size={22} color={c.text3} />}
        <Txt variant="headline" style={{ flex: 1 }}>
          {title}
        </Txt>
      </View>
      {active || done ? children : null}
    </View>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <Txt variant="callout" color="text2">
    {children}
  </Txt>
);

function ProgressBar({ percent }: { percent: number }) {
  const c = useColors();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(3, Math.min(100, percent))}%`, height: 6, backgroundColor: c.accent }} />
    </View>
  );
}

/** Apple's two-factor step and the certificate choice, answered inline. */
function Question({ q, onDone }: { q: IPhoneEvent; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  if (!bridge) return null;
  const answer = (a: Parameters<typeof bridge.answer>[0]) => {
    bridge.answer(a);
    onDone();
  };
  if (q.event === 'twoFactor') {
    const others = q.numbers.filter((n) => n.id !== q.selected);
    return (
      <View style={{ gap: 12 }}>
        <P>
          {q.sms
            ? `Enter the code Apple texted to ${q.numbers.find((n) => n.id === q.selected)?.number ?? 'your phone'}.`
            : 'Enter the 6-digit code Apple shows on your other Apple devices.'}
        </P>
        {q.lastError ? (
          <Txt variant="caption" color="accent">
            {q.lastError}
          </Txt>
        ) : null}
        <Field label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoFocus />
        <Button label="Verify" variant="accent" disabled={code.trim().length < 6} onPress={() => answer({ action: 'code', code })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {!q.unknown ? <Button size="sm" variant="secondary" label="Send again" onPress={() => answer({ action: 'resend' })} /> : null}
          {q.sms || q.unknown ? <Button size="sm" variant="secondary" label="Show on my devices" onPress={() => answer({ action: 'devices' })} /> : null}
          {others.map((n) => (
            <Button key={n.id} size="sm" variant="secondary" label={`Text ${n.number}`} onPress={() => answer({ action: 'sms', id: n.id })} />
          ))}
        </View>
      </View>
    );
  }
  if (q.event === 'maxCerts') {
    return (
      <View style={{ gap: 12 }}>
        <P>
          A free Apple Account can have 2 signing certificates, and both are in use. Pick one for ArkStore to replace. Apps
          signed with it by that tool stop opening until that tool refreshes them (or until ArkStore installs them again).
        </P>
        {q.certs.map((cert) => {
          const serial = cert.serial ?? '';
          const on = picked.includes(serial);
          return (
            <Tap
              key={serial}
              onPress={() => setPicked(on ? picked.filter((s) => s !== serial) : [serial])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              {on ? <CheckCircle size={20} weight="fill" /> : <Circle size={20} />}
              <Txt variant="callout" style={{ flex: 1 }}>
                {cert.machine || cert.name || 'Unnamed certificate'}
              </Txt>
            </Tap>
          );
        })}
        <Button label="Replace it" variant="accent" disabled={!picked.length} onPress={() => answer({ revoke: picked })} />
      </View>
    );
  }
  return null;
}

export default function IPhoneScreen() {
  const c = useColors();
  const { app: appId } = useLocalSearchParams<{ app?: string }>();
  const { data: target } = useApp(appId);
  const latest = useLatestArkStore(Boolean(bridge));

  const [driver, setDriver] = useState(true);
  const [devices, setDevices] = useState<IPhoneDevice[] | null>(null);
  const [problem, setProblem] = useState<'no-pairing' | 'vpn' | null>(null);
  // Why the iPhone list is empty, when it isn't simply "nothing plugged in".
  const [listError, setListError] = useState<string | null>(null);
  const [udid, setUdid] = useState<string | null>(null);
  const [account, setAccount] = useState<{ email: string | null; remembered: boolean; canRemember: boolean; apps: IPhoneApp[] } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<null | 'signin' | 'install' | 'refresh' | 'driver'>(null);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [question, setQuestion] = useState<IPhoneEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [devMode, setDevMode] = useState<boolean | null>(null);
  const polling = useRef(true);

  const loadAccount = useCallback(() => bridge?.account().then(setAccount).catch(() => undefined), []);

  useEffect(() => {
    if (!bridge) return;
    loadAccount();
    const stop = bridge.onEvent((e) => {
      if (e.event === 'progress') setProgress({ stage: e.stage, percent: e.percent });
      else if (e.event === 'twoFactor' || e.event === 'maxCerts') setQuestion(e);
      else if (e.event === 'refreshed') loadAccount();
    });
    return stop;
  }, [loadAccount]);

  // Watch for the iPhone: plugged in, trusted, unplugged.
  useEffect(() => {
    if (!bridge) return;
    polling.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await bridge.devices();
        setDriver(r.driver);
        setDevices(r.devices);
        setProblem(r.problem ?? null);
        setListError(r.message ?? null);
        setUdid((cur) => (cur && r.devices.some((d) => d.udid === cur) ? cur : r.devices.find((d) => d.trusted)?.udid ?? r.devices[0]?.udid ?? null));
      } catch (e) {
        setDriver(false);
        setListError((e as Error).message);
      }
      // On the iPhone each check is a network round trip through LocalDevVPN: less often.
      if (polling.current) timer = setTimeout(tick, onPhone ? 5000 : 2500);
    };
    tick();
    return () => {
      polling.current = false;
      clearTimeout(timer);
    };
  }, []);

  if (!bridge) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TopBar close title="iPhone" />
        <ScrollView contentContainerStyle={{ padding: space.gutter, gap: 14 }}>
          <Txt variant="title">Set up iPhone apps from your computer</Txt>
          <P>
            ArkStore for Windows, Mac and Linux installs iPhone apps for you, signed with your own free Apple Account. Get
            ArkStore on your computer, open it, and choose iPhone.
          </P>
          <Button label="Get ArkStore for your computer" variant="accent" onPress={() => router.push('/download')} />
        </ScrollView>
      </View>
    );
  }

  const device = devices?.find((d) => d.udid === udid) ?? null;
  const ready = Boolean(device?.trusted);
  const signedIn = Boolean(account?.email);
  const arkIpa = latest.data?.files.find((f) => f.os === 'ios' && /\.ipa$/i.test(f.name)) ?? null;
  const targetIpa = target ? rankAssets(target.assets, { os: 'ios' }).find((f) => /\.ipa$/i.test(f.name)) ?? null : null;
  const install = target
    ? targetIpa && { url: targetIpa.url, name: target.name, iconUrl: target.icon_url }
    : arkIpa && { url: arkIpa.url, name: 'ArkStore', iconUrl: 'https://github.com/Ark-Devs.png', pairFor: 'com.arkdevs.arkstore' };
  const needPassword = signedIn && !account?.remembered;

  const signIn = async () => {
    setBusy('signin');
    setError(null);
    try {
      await bridge.signIn(email, password, remember);
      await loadAccount();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setQuestion(null);
    }
  };

  const doInstall = async () => {
    if (!device || !install) return;
    setBusy('install');
    setError(null);
    setInstalled(null);
    setProgress({ stage: 'download', percent: 0 });
    try {
      await bridge.install({ udid: device.udid, ...install }, needPassword ? password : undefined);
      setInstalled(install.name);
      await loadAccount();
      bridge.devMode(device.udid).then((r) => setDevMode(r.enabled)).catch(() => setDevMode(null));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
      setQuestion(null);
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    setError(null);
    try {
      const r = await bridge.refresh();
      if (r.needsPassword) setError('Turn on "Remember my password" to refresh apps without asking.');
      else if (r.failed?.length) setError(r.failed.join('\n'));
      await loadAccount();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const myApps = (account?.apps ?? []).filter((a) => !device || a.udid === device.udid);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar close title="iPhone" />
      <ScrollView contentContainerStyle={{ padding: space.gutter, gap: 14, paddingBottom: 60, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Txt variant="title">{target ? `Install ${target.name}` : onPhone ? 'Your apps' : 'Set up your iPhone'}</Txt>
        <P>
          {onPhone
            ? 'ArkStore installs apps signed with your own free Apple Account and renews them on this iPhone, every few days, when LocalDevVPN is connected. No computer needed.'
            : 'ArkStore installs apps on your iPhone signed with your own free Apple Account. It also sets up ArkStore on the iPhone to renew them by itself, so after this you only need the computer again if you reset the iPhone.'}
        </P>

        {/* 1. The iPhone (on the iPhone itself: LocalDevVPN and the pairing file) */}
        <Step
          done={ready}
          active
          title={
            ready
              ? onPhone
                ? 'Ready: LocalDevVPN connected'
                : `Connected: ${device!.name || 'iPhone'} (iOS ${device!.ios})`
              : onPhone
                ? problem === 'no-pairing'
                  ? 'Set up once with a computer'
                  : 'Connect LocalDevVPN'
                : 'Connect your iPhone'
          }>
          {onPhone ? (
            ready ? null : problem === 'no-pairing' ? (
              <P>
                ArkStore needs to be installed once by ArkStore on a computer (Windows, Mac or Linux): open it there, go to Account ›
                Set up iPhone and install ArkStore with the iPhone plugged in. That also sets up this iPhone to renew apps by itself.
              </P>
            ) : (
              <>
                <P>
                  ArkStore reaches this iPhone through LocalDevVPN, a free app that keeps everything on the iPhone. Get it from the App
                  Store, open it and tap Connect, then come back here.
                </P>
                <Button label="Get LocalDevVPN" variant="accent" onPress={() => openInApp(IOS_LINKS.localDevVpn)} />
              </>
            )
          ) : !driver ? (
            desktop?.os === 'linux' ? (
              <>
                <P>ArkStore talks to the iPhone through usbmuxd. Install it once, then plug the iPhone in again:</P>
                <CodeBlock code="sudo apt install usbmuxd" />
              </>
            ) : desktop?.os === 'windows' ? (
              <>
                <P>Windows needs Apple&apos;s iPhone driver, which comes with iTunes or the Apple Devices app. ArkStore can install it.</P>
                <Button
                  label="Install Apple's iPhone driver"
                  variant="accent"
                  loading={busy === 'driver'}
                  onPress={async () => {
                    setBusy('driver');
                    await bridge.installDriver().catch(() => undefined);
                    setBusy(null);
                  }}
                />
              </>
            ) : (
              <P>Waiting for macOS&apos;s device service. Unlock the iPhone and plug it in again.</P>
            )
          ) : !devices?.length ? (
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <DeviceMobile size={28} color={c.text3} />
              <View style={{ flex: 1, gap: 6 }}>
                <P>Plug your iPhone into this computer with a cable and unlock it.</P>
                {listError ? (
                  <Txt variant="caption" color="accent">
                    {listError}
                  </Txt>
                ) : null}
              </View>
            </View>
          ) : !device?.trusted ? (
            <P>On the iPhone, tap Trust when it asks about this computer, and enter your passcode.</P>
          ) : devices.length > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {devices.map((d) => (
                <Button key={d.udid} size="sm" variant={d.udid === udid ? 'primary' : 'secondary'} label={d.name || d.udid.slice(0, 8)} onPress={() => setUdid(d.udid)} />
              ))}
            </View>
          ) : null}
        </Step>

        {/* 2. Apple Account */}
        <Step done={signedIn} active={ready || signedIn} title={signedIn ? `Apple Account: ${account!.email}` : 'Sign in with your Apple Account'}>
          {signedIn ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button
                size="sm"
                variant="ghost"
                label="Use a different Apple Account"
                onPress={async () => {
                  await bridge.signOut();
                  await loadAccount();
                }}
              />
            </View>
          ) : question && busy === 'signin' ? (
            <Question q={question} onDone={() => setQuestion(null)} />
          ) : (
            <>
              <P>
                A free Apple Account works; a second account just for this is a good idea. Your password goes from this
                computer straight to Apple, never to ArkStore.
              </P>
              <Field label="Apple Account email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
              <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
              {account?.canRemember ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Switch value={remember} onValueChange={setRemember} />
                  <Txt variant="callout" style={{ flex: 1 }}>
                    Remember my password (stored encrypted on this computer), so apps renew on their own
                  </Txt>
                </View>
              ) : null}
              <Button label="Sign in" variant="accent" loading={busy === 'signin'} disabled={!email.includes('@') || !password} onPress={signIn} />
            </>
          )}
        </Step>

        {/* 3. Install (on the iPhone: only when installing a chosen app) */}
        {onPhone && !target ? null : (
        <Step done={Boolean(installed)} active={ready && signedIn} title={installed ? `${installed} is on your iPhone` : `Install ${install?.name ?? 'ArkStore'}`}>
          {busy === 'install' ? (
            question ? (
              <Question q={question} onDone={() => setQuestion(null)} />
            ) : (
              <View style={{ gap: 8 }}>
                <Txt variant="callout">
                  {STAGE[progress?.stage ?? 'download']}… {progress ? `${progress.percent}%` : ''}
                </Txt>
                <ProgressBar percent={progress?.percent ?? 0} />
                <Button size="sm" variant="ghost" label="Cancel" onPress={() => bridge.cancel()} />
              </View>
            )
          ) : installed && onPhone ? (
            <P>Open it from the Home Screen. ArkStore renews it with your other apps.</P>
          ) : installed ? (
            <View style={{ gap: 10 }}>
              <P>Two things on the iPhone, once:</P>
              <P>
                1. Settings › General › VPN & Device Management › tap {account?.email ?? 'your Apple Account'} › Trust.
              </P>
              {devMode === false ? (
                <P>
                  2. Settings › Privacy & Security › Developer Mode › turn it on and restart the iPhone (ArkStore just made the
                  switch appear). Apps signed with your Apple Account need it on iOS 16 and later.
                </P>
              ) : (
                <P>2. If iOS asks for Developer Mode: Settings › Privacy & Security › Developer Mode › On, then restart.</P>
              )}
              {!target ? (
                <P>
                  3. On the iPhone, get LocalDevVPN from the App Store. Then open ArkStore there: it installs apps and renews them by
                  itself, with LocalDevVPN connected. You can unplug the iPhone.
                </P>
              ) : null}
            </View>
          ) : (
            <>
              {needPassword ? <Field label="Apple Account password" value={password} onChangeText={setPassword} secureTextEntry /> : null}
              <Button
                label={onPhone ? `Install ${install?.name ?? ''}` : `Install ${install?.name ?? 'ArkStore'} on ${device?.name || 'the iPhone'}`}
                variant="accent"
                disabled={!install || (needPassword && !password)}
                onPress={doInstall}
              />
              {!install ? <P>Finding the newest iPhone build…</P> : null}
            </>
          )}
        </Step>
        )}

        {error ? (
          <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: c.accent, padding: 14 }}>
            <Txt variant="callout" color="accent">
              {error}
            </Txt>
          </View>
        ) : null}

        {/* Installed apps and their 7 days */}
        {myApps.length ? (
          <View style={{ borderRadius: radius.card, backgroundColor: c.surface, padding: 18, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt variant="headline" style={{ flex: 1 }}>
                Signed with your Apple Account
              </Txt>
              <Button size="sm" variant="secondary" label="Renew now" loading={busy === 'refresh'} disabled={Boolean(busy)} onPress={refresh} />
            </View>
            {myApps.map((a) => {
              const left = Math.max(0, Math.ceil((Date.parse(a.installedAt) + 7 * DAY - Date.now()) / DAY));
              return (
                <View key={a.url} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <AppIcon uri={a.iconUrl} name={a.name} size={36} />
                  <Txt variant="callout" style={{ flex: 1 }} numberOfLines={1}>
                    {a.name}
                  </Txt>
                  <Txt variant="caption" color={left <= 2 ? 'accent' : 'text3'}>
                    {left ? `${left} day${left === 1 ? '' : 's'} left` : 'Expired: renew'}
                  </Txt>
                </View>
              );
            })}
            <Txt variant="caption" color="text3">
              ArkStore renews these automatically when they have 3 days left, while it&apos;s open here and the iPhone is plugged
              in or on the same Wi-Fi (for Wi-Fi, turn on &quot;Show this iPhone when on Wi-Fi&quot; once in Finder, iTunes or
              Apple Devices). A free Apple Account can have 3 apps like this at a time.
            </Txt>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
