// The iPhone and iPad guide on /download: setting up SideStore once (the only step that needs a
// computer), adding ArkStore's source, keeping apps signed, and the other ways to install.
// The setup steps follow SideStore's own docs (docs.sidestore.io/docs/installation).
import { ArrowSquareOut } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { CaretDown } from 'phosphor-react-native/src/icons/CaretDown';
import { Warning } from 'phosphor-react-native/src/icons/Warning';
import { useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { CodeBlock } from '@/components/agents/code-block';
import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { desktop } from '@/lib/desktop';
import { addSourceLink, IOS_LINKS, IOS_SOURCE_URL, openInApp } from '@/lib/ios';
import { catalogOS } from '@/lib/platform';
import { radius, useColors } from '@/theme';

export function openLink(url: string) {
  if (desktop) desktop.openExternal(url).catch(() => undefined);
  else Linking.openURL(url).catch(() => undefined);
}

function ExtLink({ label, url }: { label: string; url: string }) {
  const c = useColors();
  return (
    <Tap onPress={() => openLink(url)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' }}>
      <Txt variant="label" color="accent">
        {label}
      </Txt>
      <ArrowSquareOut size={13} color={c.accent} />
    </Tap>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Txt variant="mono" style={{ fontSize: 12 }}>
          {n}
        </Txt>
      </View>
      <View style={{ flex: 1, gap: 6, paddingTop: 3 }}>
        <Txt variant="headline">{title}</Txt>
        {children}
      </View>
    </View>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <Txt variant="callout" color="text2">
    {children}
  </Txt>
);

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <View style={{ gap: 4 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Txt variant="callout" color="text3">
            •
          </Txt>
          <Txt variant="callout" color="text2" style={{ flex: 1 }}>
            {item}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** A section that opens on tap, so the page stays short for people who've done the setup. */
function Section({ title, subtitle, open: initial = false, children }: { title: string; subtitle: string; open?: boolean; children: ReactNode }) {
  const c = useColors();
  const [open, setOpen] = useState(initial);
  return (
    <View style={{ borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <Tap
        scale={0.995}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20 }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title" size={19}>
            {title}
          </Txt>
          <Txt variant="callout" color="text2">
            {subtitle}
          </Txt>
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <CaretDown size={18} color={c.text2} />
        </View>
      </Tap>
      {open ? <View style={{ paddingHorizontal: 20, paddingBottom: 22, gap: 18 }}>{children}</View> : null}
    </View>
  );
}

function Note({ children, warn }: { children: ReactNode; warn?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: radius.tile, borderWidth: 1, borderColor: warn ? c.accent : c.line }}>
      {warn ? <Warning size={18} color={c.accent} /> : null}
      <Txt variant="callout" color="text2" style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

/** "Add to SideStore / AltStore" buttons on an iPhone; the source URL to copy everywhere else. */
export function AddSourceButtons() {
  const onPhone = catalogOS() === 'ios';
  return (
    <View style={{ gap: 12 }}>
      {onPhone ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Button label="Add ArkStore to SideStore" variant="accent" onPress={() => openInApp(addSourceLink.sidestore)} />
          <Button label="Add to AltStore" variant="secondary" onPress={() => openInApp(addSourceLink.altstore)} />
        </View>
      ) : (
        <P>Open this page on your iPhone or iPad to add ArkStore in one tap, or copy the source link below.</P>
      )}
      <CodeBlock code={IOS_SOURCE_URL} label="ArkStore source (SideStore, AltStore, Feather: Sources, then +)" />
    </View>
  );
}

export function IosGuide() {
  const c = useColors();
  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8, paddingHorizontal: 4 }}>
        <Txt variant="title" accessibilityRole="header">
          Install apps on iPhone and iPad
        </Txt>
        <Txt variant="body" color="text2" style={{ maxWidth: 760 }}>
          Apple only lets iPhones install apps from the App Store. SideStore gets around that with your own free Apple
          Account: it signs apps on the phone itself and renews them before they run out, so after a one-time setup with a
          computer (about 15 minutes) you never need the computer again. Then ArkStore&apos;s iOS apps install in SideStore with
          one tap.
        </Txt>
      </View>

      <Section title="1. What you need" subtitle="Once, for the setup" open>
        <Bullets
          items={[
            'An iPhone or iPad on iOS or iPadOS 15 or later, with a passcode set.',
            'A free Apple Account. Your usual one works; a second one just for this is fine too.',
            'A computer, only for the setup: Windows 8 or later (not 32-bit Windows or Windows 10 on Arm), macOS High Sierra or later, Linux, or a Chromebook with Linux turned on.',
            'A USB cable for your iPhone, and Wi-Fi (the setup and refreshes don’t work over mobile data).',
          ]}
        />
      </Section>

      <Section title="2. Set up SideStore" subtitle="The only part that needs a computer" open>
        <Step n={1} title="On your iPhone: install LocalDevVPN">
          <P>
            Get LocalDevVPN from the App Store (search for it by name). SideStore uses it to talk to your iPhone without a
            computer. It stays on the phone, and it needs to be connected whenever SideStore installs or refreshes an app.
          </P>
        </Step>
        <Step n={2} title="On your computer: install iloader">
          <Bullets
            items={[
              'Windows: install iTunes from Apple’s website (not the Microsoft Store version) or the Apple Devices app, then the iloader installer.',
              'Mac: install iloader.',
              'Linux: install usbmuxd from your package manager, then iloader (.deb, .rpm or AppImage).',
              'Chromebook: turn on the Linux development environment, install usbmuxd, fuse and curl in it, then the iloader AppImage.',
            ]}
          />
          <ExtLink label="Download iloader" url={`${IOS_LINKS.iloader}/releases/latest`} />
        </Step>
        <Step n={3} title="Connect your iPhone">
          <P>Plug it into the computer with the cable. If it asks, tap Trust and enter your passcode.</P>
        </Step>
        <Step n={4} title="Install SideStore with iloader">
          <P>
            Open iloader, sign in with your Apple Account (the email is case-sensitive), pick your iPhone and choose Install
            SideStore (Stable).
          </P>
        </Step>
        <Step n={5} title="On your iPhone: trust your Apple Account">
          <P>
            Settings, General, VPN &amp; Device Management. Under Developer App, tap your Apple Account, then Trust. On iOS 18
            and later it says Allow &amp; Restart and asks for your passcode.
          </P>
        </Step>
        <Step n={6} title="Turn on Developer Mode (iOS 16 and later)">
          <P>Settings, Privacy &amp; Security, scroll to the bottom and turn on Developer Mode. The iPhone restarts.</P>
        </Step>
        <Step n={7} title="Connect LocalDevVPN, then open SideStore">
          <P>
            In LocalDevVPN tap Connect. Open SideStore and sign in with the same Apple Account you used in iloader.
          </P>
        </Step>
        <Step n={8} title="Finish with a first refresh">
          <P>
            In SideStore go to My Apps and tap the 7 DAYS button next to SideStore. If it asks to revoke or make a new signing
            certificate, tap Yes or Refresh Now. SideStore closes to the Home Screen and is back a few seconds later.
          </P>
        </Step>
        <Note>That&apos;s it: unplug the cable. From now on everything happens on the iPhone.</Note>
        <ExtLink label="SideStore's full install guide" url={`${IOS_LINKS.sidestoreDocs}/docs/installation/install`} />
      </Section>

      <Section title="3. Add ArkStore and install apps" subtitle="Every open-source iOS app on ArkStore, in SideStore" open>
        <AddSourceButtons />
        <P>
          Once the source is added, open Browse in SideStore to see ArkStore&apos;s apps, or tap GET on any iOS app here and choose
          Add to SideStore. When a developer publishes a new release, SideStore shows the update.
        </P>
      </Section>

      <Section title="4. Keep your apps working" subtitle="How the 7-day limit is handled, and Apple's limits">
        <P>
          Apps signed with a free Apple Account work for 7 days. SideStore renews them for you: every few days, with Wi-Fi and
          LocalDevVPN connected, open SideStore and tap Refresh All in My Apps. Nothing needs a computer. If an app does run
          out, it isn&apos;t deleted: refresh it and it opens again with your data.
        </P>
        <Bullets
          items={[
            'A free Apple Account can have 3 of these apps on a device at a time, SideStore included. Remove one in My Apps to make room.',
            'It can register 10 new app IDs every 7 days, so installing lots of different apps in one week can hit the limit. It resets on its own.',
            'A paid Apple Developer account removes both limits and makes signatures last a year.',
          ]}
        />
      </Section>

      <Section title="5. If something goes wrong" subtitle="The usual fixes">
        <Bullets
          items={[
            'SideStore can’t connect or refresh: check you’re on Wi-Fi and LocalDevVPN says Connected, then try again.',
            'It stopped working after an iOS update or reset: the pairing file expired. Connect the iPhone to a computer and make a new one with iloader (SideStore’s docs walk through it). This is the only time you’d need a computer again.',
            'An app won’t open: it ran out. Refresh it in SideStore’s My Apps.',
            '"Maximum apps" error: you already have 3 apps. Remove one in My Apps.',
          ]}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
          <ExtLink label="Common issues" url={`${IOS_LINKS.sidestoreDocs}/docs/troubleshooting/common-issues`} />
          <ExtLink label="SideStore FAQ" url={`${IOS_LINKS.sidestoreDocs}/docs/faq`} />
        </View>
      </Section>

      <Section title="Other ways to install" subtitle="TrollStore, AltStore, or your own certificate">
        <View style={{ gap: 6 }}>
          <Txt variant="headline">TrollStore: permanent, no limits</Txt>
          <P>
            On the iOS versions it supports, TrollStore installs apps for good: no refreshing, no app limit, no Apple Account.
            Check whether your iOS version is supported. On an iOS app&apos;s page here, tap GET, then Install with TrollStore.
          </P>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
            <ExtLink label="Supported versions and install" url={IOS_LINKS.trollstoreCompat} />
            <ExtLink label="TrollStore on GitHub" url={IOS_LINKS.trollstore} />
          </View>
        </View>
        <DotRule />
        <View style={{ gap: 6 }}>
          <Txt variant="headline">AltStore</Txt>
          <P>
            Works like SideStore, but refreshes through AltServer on a computer on the same Wi-Fi. ArkStore&apos;s source works in it
            too (Add to AltStore above).
          </P>
        </View>
        <DotRule />
        <View style={{ gap: 6 }}>
          <Txt variant="headline">Your own developer certificate</Txt>
          <P>
            With a paid Apple Developer account, sign apps in Feather with your own certificate: they last a year, with no app
            limit. Download the IPA from an app&apos;s page and open it in Feather, or add ArkStore&apos;s source there.
          </P>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
            <ExtLink label="Feather" url={IOS_LINKS.feather} />
            <ExtLink label="Apple Developer Program" url={IOS_LINKS.appleDeveloper} />
          </View>
        </View>
        <Note warn>
          Stay away from sites that offer free &quot;certificates&quot; or install any app without setup. They use certificates shared
          by thousands of people, which Apple revokes often (every app stops opening), and whoever owns the certificate controls
          what gets installed. Never type your Apple Account password into a website.
        </Note>
      </Section>

      <Txt variant="caption" color="text3" style={{ paddingHorizontal: 4, color: c.text3 }}>
        ArkStore lists apps and links to the developers&apos; own IPA files on GitHub. It doesn&apos;t sign apps or hold your Apple
        Account. SideStore, AltStore, TrollStore and Feather are separate open-source projects.
      </Txt>
    </View>
  );
}
