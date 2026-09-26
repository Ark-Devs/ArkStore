import { useLocalSearchParams } from 'expo-router';
import { GithubLogo } from 'phosphor-react-native/src/icons/GithubLogo';
import { Globe } from 'phosphor-react-native/src/icons/Globe';
import { Linking, ScrollView, View } from 'react-native';

import { InstallGuideTabs } from '@/components/agents/install-guide';
import { AppIcon } from '@/components/ui/app-icon';
import { Button } from '@/components/ui/button';
import { DotRule } from '@/components/ui/dots';
import { EmptyState, RowSkeleton, SectionHeader } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { installSummary } from '@/lib/agent-install';
import { useAgentTool } from '@/lib/agents';
import { relativeDate } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { space, useColors } from '@/theme';

const SOURCE: Record<string, string> = {
  registry: 'Listed in the official MCP registry',
  marketplace: 'From a Claude Code plugin marketplace',
  arkstore: 'Made by ArkStore',
};

export default function AgentToolScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const tool = useAgentTool(id);
  const t = tool.data;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar />
      {tool.isLoading ? (
        <RowSkeleton count={4} />
      ) : !t ? (
        <EmptyState glyph="!?" title="Not found" body={tool.error ? friendlyError(tool.error) : 'This entry is no longer listed.'} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 80, gap: 24 }}>
          <View style={{ paddingHorizontal: space.gutter, flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <AppIcon uri={t.icon_url} name={t.title} size={84} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Txt variant="title" numberOfLines={2}>
                {t.title}
              </Txt>
              <Txt variant="callout" color="text2" numberOfLines={1}>
                {t.publisher ?? t.name}
              </Txt>
              <Txt variant="mono" color="text3" numberOfLines={1} style={{ fontSize: 11 }}>
                {[installSummary(t), t.version ? `v${t.version.replace(/^v/i, '')}` : null].filter(Boolean).join('  ·  ')}
              </Txt>
            </View>
          </View>

          {t.description ? (
            <Txt variant="body" style={{ paddingHorizontal: space.gutter }}>
              {t.description}
            </Txt>
          ) : null}

          <View style={{ paddingHorizontal: space.gutter, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {t.repo_url ? (
              <Button
                label="Source"
                variant="secondary"
                size="sm"
                icon={<GithubLogo size={16} color={c.text} />}
                onPress={() => Linking.openURL(t.repo_url!)}
              />
            ) : null}
            {t.homepage ? (
              <Button label="Website" variant="secondary" size="sm" icon={<Globe size={16} color={c.text} />} onPress={() => Linking.openURL(t.homepage!)} />
            ) : null}
          </View>

          <View>
            <SectionHeader title="Install" />
            <View style={{ paddingHorizontal: space.gutter }}>
              <InstallGuideTabs tool={t} />
            </View>
          </View>

          <DotRule style={{ marginHorizontal: space.gutter }} />
          <Txt variant="caption" color="text3" style={{ paddingHorizontal: space.gutter }}>
            {SOURCE[t.source] ?? ''} · last update: {relativeDate(t.updated_at)}. ArkStore doesn&apos;t review MCP servers or plugins:
            check the source before you give one access to your accounts or files.
          </Txt>
        </ScrollView>
      )}
    </View>
  );
}
