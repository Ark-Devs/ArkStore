import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowSquareOut } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { Check } from 'phosphor-react-native/src/icons/Check';
import { CheckCircle } from 'phosphor-react-native/src/icons/CheckCircle';
import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { Plus } from 'phosphor-react-native/src/icons/Plus';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { WarningCircle } from 'phosphor-react-native/src/icons/WarningCircle';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryIcon } from '@/components/store/category-icon';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotGrid, DotLoader, DotRule } from '@/components/ui/dots';
import { Field } from '@/components/ui/field';
import { Chip, EmptyState, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useApp, useCategories } from '@/lib/api';
import { getGitHubToken, useAuth } from '@/lib/auth';
import { androidVersion, compactNumber, fileSize, relativeDate } from '@/lib/format';
import { detectRepo, GitHubError, type Detection } from '@/lib/github/detect';
import { parseRepoInput, repoUrl } from '@/lib/github/repo';
import { listMyRepos, publishApp, updateListing, uploadImage } from '@/lib/publish';
import { friendlyError } from '@/lib/supabase';
import type { StoreApp } from '@/lib/types';
import { radius, space, useColors } from '@/theme';

type Step = 'pick' | 'scanning' | 'form' | 'done';

type Draft = {
  repo: string;
  name: string;
  subtitle: string;
  description: string;
  category: string;
  icon: string | null;
  screenshots: string[];
};

const SCAN_LINES = [
  'Reading the repository',
  'Looking for APKs in your releases',
  'Reading your store listing',
  'Finding the icon and screenshots',
  'Checking the package and Android version',
];

const MAX_SHOTS = 10;

// ---------------------------------------------------------------------------

function RepoPicker({ onPick, error }: { onPick: (repo: string) => void; error: string | null }) {
  const c = useColors();
  const [input, setInput] = useState('');
  const token = useQuery({ queryKey: ['gh-token'], queryFn: getGitHubToken });
  const repos = useQuery({
    queryKey: ['my-repos'],
    enabled: Boolean(token.data),
    queryFn: () => listMyRepos(token.data!),
  });
  const parsed = parseRepoInput(input);

  return (
    <ScrollView contentContainerStyle={{ padding: space.gutter, gap: 18, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6 }}>
        <Txt variant="display">Link your repo</Txt>
        <Txt variant="body" color="text2">
          ArkStore reads the repo and fills in the listing for you. You can change anything before it goes live.
        </Txt>
      </View>

      <Field
        label="GitHub repository"
        value={input}
        onChangeText={setInput}
        placeholder="github.com/you/your-app"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => parsed && onPick(parsed.fullName)}
        helper="A link, git@github.com:owner/repo.git or owner/repo all work."
        error={input.length > 3 && !parsed ? "That doesn't look like a GitHub repo." : error}
      />
      <Button label="Recognize app" size="lg" full disabled={!parsed} onPress={() => parsed && onPick(parsed.fullName)} />

      {token.data ? (
        <>
          <SectionHeader title="Your repositories" />
          {repos.isLoading ? (
            <View style={{ alignItems: 'center', padding: 20 }}>
              <DotLoader />
            </View>
          ) : repos.error ? (
            <Txt variant="callout" color="text2">
              {friendlyError(repos.error).includes('github_token_expired')
                ? 'Your GitHub session expired. Sign out and back in to see your repos.'
                : friendlyError(repos.error)}
            </Txt>
          ) : (
            <View style={{ marginHorizontal: -space.gutter }}>
              {(repos.data ?? []).slice(0, 40).map((r, i) => (
                <View key={r.full_name}>
                  {i > 0 ? <DotRule style={{ marginHorizontal: space.gutter }} /> : null}
                  <Tap
                    scale={0.99}
                    onPress={() => onPick(r.full_name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${r.full_name}`}
                    style={{ paddingHorizontal: space.gutter, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  >
                    <GithubLogo size={22} color={c.text2} weight="light" />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt variant="headline" numberOfLines={1}>
                        {r.full_name}
                      </Txt>
                      <Txt variant="caption" color="text2" numberOfLines={1}>
                        {r.description || 'No description'}
                      </Txt>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Star size={12} color={c.text3} weight="fill" />
                      <Txt variant="mono" color="text3" style={{ fontSize: 11 }}>
                        {compactNumber(r.stargazers_count)}
                      </Txt>
                    </View>
                  </Tap>
                </View>
              ))}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function Scanning({ repo, lines }: { repo: string; lines: number }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, padding: space.gutter, justifyContent: 'center', gap: 28 }}>
      <View style={{ height: 220, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <DotGrid gap={12} size={1.2} />
        <DotLoader size={9} color={c.accent} />
        <Txt variant="mono" color="text2">
          {repo}
        </Txt>
      </View>
      <View style={{ gap: 12 }}>
        {SCAN_LINES.map((line, i) => (
          <View key={line} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: i < lines ? 1 : 0.25 }}>
            {i < lines - 1 ? (
              <CheckCircle size={20} color={c.text} weight="fill" />
            ) : (
              <View style={{ width: 20, alignItems: 'center' }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i < lines ? c.accent : c.surface3 }} />
              </View>
            )}
            <Txt variant="body">{line}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

function NoApk({ detection, onRetry, onBack }: { detection: Detection; onRetry: () => void; onBack: () => void }) {
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={{ padding: space.gutter }}>
      <EmptyState
        glyph="APK?"
        title={`No APK in ${detection.repo.full_name} yet`}
        body="ArkStore installs the APK attached to your newest GitHub release. Build a release APK, attach it to a release (the Assets section), then scan again."
        action={
          <View style={{ gap: 10, alignItems: 'center' }}>
            <Button
              label="Open releases on GitHub"
              icon={<ArrowSquareOut size={16} color={c.onInvert} />}
              onPress={() => Linking.openURL(`${repoUrl(detection.repo.full_name)}/releases/new`)}
            />
            <Button label="Scan again" variant="secondary" onPress={onRetry} />
            <Button label="Use a different repo" variant="ghost" onPress={onBack} />
          </View>
        }
      />
    </ScrollView>
  );
}

function Recognized({ detection }: { detection: Detection }) {
  const c = useColors();
  const r = detection.release!;
  const facts = [
    `${r.version}${r.prerelease ? ' beta' : ''}  ·  ${r.apks.length} ${r.apks.length === 1 ? 'APK' : 'builds'}`,
    `released ${relativeDate(r.publishedAt).toLowerCase()}`,
    detection.metadataSource === 'fastlane'
      ? 'fastlane listing'
      : detection.metadataSource === 'play-listing'
        ? 'Play listing files'
        : detection.metadataSource === 'readme'
          ? 'from README'
          : 'from repo',
    detection.packageName,
    androidVersion(detection.minSdk),
  ].filter(Boolean) as string[];

  return (
    <View style={{ borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
      <DotGrid gap={12} size={1.1} />
      <View style={{ padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={18} color={c.accent} weight="fill" />
          <Txt variant="label" color="accent">
            Recognized
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {facts.map((f) => (
            <View key={f} style={{ paddingHorizontal: 10, height: 26, borderRadius: radius.pill, backgroundColor: c.surface2, justifyContent: 'center' }}>
              <Txt variant="mono" style={{ fontSize: 11 }}>
                {f}
              </Txt>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function ImageTile({
  uri,
  selected,
  order,
  onPress,
  width,
  height,
  label,
}: {
  uri: string;
  selected: boolean;
  order?: number;
  onPress: () => void;
  width: number;
  height: number;
  label: string;
}) {
  const c = useColors();
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        width,
        height,
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: selected ? c.accent : c.line,
        backgroundColor: c.surface2,
      }}
    >
      <Image source={{ uri }} style={{ width: '100%', height: '100%', opacity: selected ? 1 : 0.55 }} contentFit="cover" transition={150} />
      {selected ? (
        <View
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: c.accent,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 5,
          }}
        >
          {order ? (
            <Txt variant="label" color="onAccent" style={{ fontSize: 10, letterSpacing: 0, fontFamily: 'SpaceMono_700Bold' }}>
              {order}
            </Txt>
          ) : (
            <Check size={12} color={c.onAccent} weight="bold" />
          )}
        </View>
      ) : null}
    </Tap>
  );
}

function AddTile({ onPress, width, height, busy, label }: { onPress: () => void; width: number; height: number; busy: boolean; label: string }) {
  const c = useColors();
  return (
    <Tap
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width, height, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: c.text3, alignItems: 'center', justifyContent: 'center', gap: 4 }}
    >
      {busy ? <DotLoader size={4} /> : <Plus size={20} color={c.text2} />}
      <Txt variant="label" color="text2" style={{ fontSize: 9 }}>
        Upload
      </Txt>
    </Tap>
  );
}

// ---------------------------------------------------------------------------

export default function PublishScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ repo?: string; edit?: string }>();
  const session = useAuth((s) => s.session);
  const categories = useCategories();
  const editing = useApp(params.edit);

  const [step, setStep] = useState<Step>(params.edit ? 'form' : 'pick');
  const [scanLines, setScanLines] = useState(0);
  const [scanRepo, setScanRepo] = useState('');
  const [pickError, setPickError] = useState<string | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [iconChoices, setIconChoices] = useState<string[]>([]);
  const [shotChoices, setShotChoices] = useState<string[]>([]);
  const [uploading, setUploading] = useState<'icon' | 'shot' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [published, setPublished] = useState<StoreApp | null>(null);
  const started = useRef(false);

  // Edit mode: start from the saved listing.
  useEffect(() => {
    const app = editing.data;
    if (!app || draft) return;
    setDraft({
      repo: app.repo_full_name,
      name: app.name,
      subtitle: app.subtitle,
      description: app.description,
      category: app.category,
      icon: app.icon_url,
      screenshots: app.screenshots,
    });
    setIconChoices(app.icon_url ? [app.icon_url] : []);
    setShotChoices(app.screenshots);
  }, [editing.data, draft]);

  const scan = async (repo: string) => {
    const ref = parseRepoInput(repo);
    if (!ref) return;
    setPickError(null);
    setScanRepo(ref.fullName);
    setStep('scanning');
    setScanLines(1);
    const ticker = setInterval(() => setScanLines((n) => Math.min(n + 1, SCAN_LINES.length)), 420);
    const minimum = new Promise((r) => setTimeout(r, SCAN_LINES.length * 420 + 200));
    try {
      const token = await getGitHubToken();
      const [d] = await Promise.all([detectRepo(ref, { token }), minimum]);
      setDetection(d);
      if (d.release) {
        setDraft({
          repo: d.repo.full_name,
          name: d.name,
          subtitle: d.subtitle,
          description: d.description,
          category: d.category,
          icon: d.iconCandidates[0] ?? null,
          screenshots: d.screenshotCandidates.slice(0, 6),
        });
        setIconChoices(d.iconCandidates);
        setShotChoices(d.screenshotCandidates);
      }
      setStep('form');
    } catch (e) {
      setPickError(e instanceof GitHubError ? e.message : friendlyError(e));
      setStep('pick');
    } finally {
      clearInterval(ticker);
    }
  };

  // Claim flow: /publish?repo=owner/name scans straight away.
  useEffect(() => {
    if (params.repo && !started.current) {
      started.current = true;
      scan(params.repo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.repo]);

  const pickImage = async (kind: 'icon' | 'shot') => {
    if (!session) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: kind === 'icon',
      aspect: kind === 'icon' ? [1, 1] : undefined,
    });
    if (res.canceled || !res.assets[0]) return;
    setUploading(kind);
    try {
      const asset = res.assets[0];
      const url = await uploadImage(asset.uri, session.user.id, asset.mimeType ?? 'image/jpeg');
      if (kind === 'icon') {
        setIconChoices((list) => [url, ...list]);
        setDraft((d) => (d ? { ...d, icon: url } : d));
      } else {
        setShotChoices((list) => [...list, url]);
        setDraft((d) => (d && d.screenshots.length < MAX_SHOTS ? { ...d, screenshots: [...d.screenshots, url] } : d));
      }
    } catch (e) {
      setSaveError(friendlyError(e));
    } finally {
      setUploading(null);
    }
  };

  const toggleShot = (url: string) =>
    setDraft((d) => {
      if (!d) return d;
      const on = d.screenshots.includes(url);
      if (!on && d.screenshots.length >= MAX_SHOTS) return d;
      return { ...d, screenshots: on ? d.screenshots.filter((s) => s !== url) : [...d.screenshots, url] };
    });

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      let app: StoreApp;
      if (params.edit) {
        app = await updateListing(params.edit, {
          name: draft.name.trim(),
          subtitle: draft.subtitle.trim(),
          description: draft.description.trim(),
          category: draft.category,
          icon_url: draft.icon,
          screenshots: draft.screenshots,
        });
      } else {
        app = await publishApp(
          {
            repo: draft.repo,
            name: draft.name.trim(),
            subtitle: draft.subtitle.trim(),
            description: draft.description.trim(),
            category: draft.category,
            icon_url: draft.icon,
            screenshots: draft.screenshots,
            homepage: detection?.repo.homepage?.startsWith('https://') ? detection.repo.homepage : null,
            package_name: detection?.packageName ?? null,
            min_sdk: detection?.minSdk ?? null,
          },
          await getGitHubToken(),
        );
      }
      await qc.invalidateQueries();
      setPublished(app);
      setStep('done');
    } catch (e) {
      setSaveError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <TopBar close />
        <EmptyState
          glyph="@"
          title="Sign in to publish"
          body="ArkStore uses your GitHub account to confirm the repo is yours."
          action={<Button label="Go to Studio" onPress={() => router.replace('/studio')} />}
        />
      </View>
    );
  }

  if (step === 'done' && published) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.gutter, gap: 18 }}>
          <View style={{ height: 240, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <DotGrid gap={12} size={1.3} />
            <AppIcon uri={published.icon_url} name={published.name} size={96} />
            <Txt variant="label" color="accent">
              {params.edit ? 'Saved' : 'Live on ArkStore'}
            </Txt>
          </View>
          <Txt variant="display">{params.edit ? 'Listing updated' : `${published.name} is live`}</Txt>
          <Txt variant="body" color="text2">
            {params.edit
              ? 'Your changes are visible to everyone now.'
              : 'Anyone can install it now. When you publish a new GitHub release, ArkStore picks it up within 30 minutes and tells everyone who installed it.'}
          </Txt>
          <Button label="View listing" size="lg" full onPress={() => router.replace(`/app/${published.id}`)} />
          <Button label="Done" variant="secondary" size="lg" full onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const iconSize = 64;
  const shotW = 92;
  const shotH = 190;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar close title={params.edit ? 'Edit listing' : 'Publish'} />

      {step === 'pick' ? <RepoPicker onPick={scan} error={pickError} /> : null}
      {step === 'scanning' ? <Scanning repo={scanRepo} lines={scanLines} /> : null}

      {step === 'form' && detection && !detection.release ? (
        <NoApk detection={detection} onRetry={() => scan(detection.repo.full_name)} onBack={() => setStep('pick')} />
      ) : null}

      {step === 'form' && draft && (params.edit || detection?.release) ? (
        <>
          <ScrollView contentContainerStyle={{ padding: space.gutter, gap: 22, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
            {detection?.release ? <Recognized detection={detection} /> : null}

            <View style={{ gap: 10 }}>
              <Txt variant="label" color="text2">
                Icon
              </Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {iconChoices.map((u) => (
                  <ImageTile
                    key={u}
                    uri={u}
                    selected={draft.icon === u}
                    width={iconSize}
                    height={iconSize}
                    label="Use this icon"
                    onPress={() => setDraft({ ...draft, icon: u })}
                  />
                ))}
                <AddTile onPress={() => pickImage('icon')} width={iconSize} height={iconSize} busy={uploading === 'icon'} label="Upload an icon" />
              </ScrollView>
            </View>

            <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} maxLength={40} />
            <Field
              label="Subtitle"
              value={draft.subtitle}
              onChangeText={(subtitle) => setDraft({ ...draft, subtitle })}
              maxLength={80}
              helper="One line under the name. Say what it does."
            />

            <View style={{ gap: 10 }}>
              <Txt variant="label" color="text2">
                Category
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(categories.data ?? []).map((cat) => (
                  <Chip
                    key={cat.slug}
                    label={cat.name}
                    active={draft.category === cat.slug}
                    icon={<CategoryIcon name={cat.icon} size={15} color={draft.category === cat.slug ? c.onInvert : c.text} />}
                    onPress={() => setDraft({ ...draft, category: cat.slug })}
                  />
                ))}
              </View>
            </View>

            <Field
              label="Description"
              value={draft.description}
              onChangeText={(description) => setDraft({ ...draft, description })}
              maxLength={4000}
              multiline
            />

            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Txt variant="label" color="text2">
                  Screenshots
                </Txt>
                <Txt variant="mono" color="text3" style={{ fontSize: 11 }}>
                  {draft.screenshots.length}/{MAX_SHOTS} selected
                </Txt>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {shotChoices.map((u) => {
                  const order = draft.screenshots.indexOf(u);
                  return (
                    <ImageTile
                      key={u}
                      uri={u}
                      selected={order >= 0}
                      order={order >= 0 ? order + 1 : undefined}
                      width={shotW}
                      height={shotH}
                      label={order >= 0 ? `Screenshot ${order + 1}, tap to remove` : 'Add this screenshot'}
                      onPress={() => toggleShot(u)}
                    />
                  );
                })}
                <AddTile onPress={() => pickImage('shot')} width={shotW} height={shotH} busy={uploading === 'shot'} label="Upload a screenshot" />
              </ScrollView>
              <Txt variant="caption" color="text3">
                Tap to pick and order. Found {shotChoices.length} in your repo.
              </Txt>
            </View>

            {detection?.release ? (
              <View style={{ gap: 4 }}>
                <Txt variant="label" color="text2">
                  Release
                </Txt>
                <Txt variant="callout" color="text2">
                  {detection.release.apk.name}  ·  {fileSize(detection.release.apk.size)}. Future GitHub releases update this
                  listing automatically.
                </Txt>
              </View>
            ) : null}
          </ScrollView>

          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: space.gutter,
              paddingBottom: insets.bottom + 14,
              backgroundColor: c.bg,
              borderTopWidth: 1,
              borderTopColor: c.line,
              gap: 8,
            }}
          >
            {saveError ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <WarningCircle size={18} color={c.accent} />
                <Txt variant="callout" color="accent" style={{ flex: 1 }}>
                  {saveError}
                </Txt>
              </View>
            ) : null}
            <Button
              label={params.edit ? 'Save changes' : 'Publish to ArkStore'}
              size="lg"
              full
              loading={saving}
              disabled={!draft.name.trim() || !draft.category}
              onPress={submit}
            />
          </View>
        </>
      ) : null}

      {step === 'form' && params.edit && !draft ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <DotLoader />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
