import { File } from 'phosphor-react-native/src/icons/File';
import { Folder } from 'phosphor-react-native/src/icons/Folder';
import { GitFork } from 'phosphor-react-native/src/icons/GitFork';
import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { Star } from 'phosphor-react-native/src/icons/Star';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { RowSkeleton, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { compactNumber, relativeDate } from '@/lib/format';
import { useRepoOverview } from '@/lib/github/explore';
import { repoUrl } from '@/lib/github/repo';
import { radius, space, useColors } from '@/theme';

const FILES_SHOWN = 12;

/** The tool's GitHub repo, browsable in place: numbers, topics, README and top-level files. */
export function RepoExplorer({ fullName }: { fullName: string }) {
  const c = useColors();
  const overview = useRepoOverview(fullName);
  const [readmeOpen, setReadmeOpen] = useState(false);
  const [allFiles, setAllFiles] = useState(false);

  if (overview.isLoading) {
    return (
      <View>
        <SectionHeader title="Repository" />
        <RowSkeleton count={3} />
      </View>
    );
  }
  if (!overview.data) {
    return (
      <View style={{ paddingHorizontal: space.gutter, gap: 10 }}>
        <SectionHeader title="Repository" />
        <Txt variant="callout" color="text2">
          {overview.error instanceof Error ? overview.error.message : "Couldn't load the repository."}
        </Txt>
        <Button
          label={`Open ${fullName} on GitHub`}
          variant="secondary"
          size="sm"
          icon={<GithubLogo size={16} color={c.text} />}
          onPress={() => Linking.openURL(repoUrl(fullName))}
        />
      </View>
    );
  }

  const { repo, readme, readmeUrl, entries } = overview.data;
  const stats = [
    { icon: <Star size={13} color={c.text2} weight="fill" />, text: `${compactNumber(repo.stargazers_count)} stars` },
    { icon: <GitFork size={13} color={c.text2} />, text: `${compactNumber(repo.forks_count ?? 0)} forks` },
    repo.language ? { icon: null, text: repo.language } : null,
    repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? { icon: null, text: repo.license.spdx_id } : null,
    repo.pushed_at ? { icon: null, text: `pushed ${relativeDate(repo.pushed_at).toLowerCase()}` } : null,
  ].filter(Boolean) as { icon: React.ReactNode; text: string }[];
  const files = allFiles ? entries : entries.slice(0, FILES_SHOWN);

  return (
    <View style={{ gap: 14 }}>
      <SectionHeader title="Repository" action="GitHub" onAction={() => Linking.openURL(repo.html_url)} />

      <Tap
        onPress={() => Linking.openURL(repo.html_url)}
        accessibilityRole="link"
        accessibilityLabel={`Open ${repo.full_name} on GitHub`}
        style={{ marginHorizontal: space.gutter, padding: 14, borderRadius: radius.tile, backgroundColor: c.surface, gap: 10 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <GithubLogo size={18} color={c.text} />
          <Txt variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {repo.full_name}
          </Txt>
          {repo.archived ? (
            <Txt variant="label" color="accent" style={{ fontSize: 9 }}>
              Archived
            </Txt>
          ) : null}
        </View>
        {repo.description ? (
          <Txt variant="callout" color="text2">
            {repo.description}
          </Txt>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {stats.map((s) => (
            <View
              key={s.text}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 26, borderRadius: radius.pill, backgroundColor: c.surface2 }}
            >
              {s.icon}
              <Txt variant="mono" style={{ fontSize: 11 }}>
                {s.text}
              </Txt>
            </View>
          ))}
        </View>
        {repo.topics?.length ? (
          <Txt variant="mono" color="text3" style={{ fontSize: 11 }} numberOfLines={2}>
            {repo.topics.map((t) => `#${t}`).join('  ')}
          </Txt>
        ) : null}
      </Tap>

      {readme ? (
        <View style={{ paddingHorizontal: space.gutter, gap: 8 }}>
          <Txt variant="subhead">README</Txt>
          <Txt variant="body" color="text2" numberOfLines={readmeOpen ? undefined : 8}>
            {readme}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={readmeOpen ? 'Less' : 'More'} variant="ghost" size="sm" onPress={() => setReadmeOpen((v) => !v)} />
            {readmeUrl ? <Button label="Full README" variant="ghost" size="sm" onPress={() => Linking.openURL(readmeUrl)} /> : null}
          </View>
        </View>
      ) : null}

      {entries.length ? (
        <View>
          <Txt variant="subhead" style={{ paddingHorizontal: space.gutter, marginBottom: 4 }}>
            Files
          </Txt>
          {files.map((e, i) => {
            const Glyph = e.type === 'dir' ? Folder : File;
            return (
              <View key={e.path}>
                {i > 0 ? <DotRule style={{ marginHorizontal: space.gutter }} /> : null}
                <Tap
                  scale={0.99}
                  onPress={() => Linking.openURL(e.html_url)}
                  accessibilityRole="link"
                  accessibilityLabel={`${e.type === 'dir' ? 'Folder' : 'File'} ${e.name}`}
                  style={{ paddingHorizontal: space.gutter, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <Glyph size={18} color={e.type === 'dir' ? c.accent : c.text2} weight={e.type === 'dir' ? 'fill' : 'light'} />
                  <Txt variant="mono" numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>
                    {e.name}
                  </Txt>
                </Tap>
              </View>
            );
          })}
          {entries.length > FILES_SHOWN && !allFiles ? (
            <View style={{ paddingHorizontal: space.gutter }}>
              <Button label={`Show all ${entries.length}`} variant="ghost" size="sm" onPress={() => setAllFiles(true)} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
