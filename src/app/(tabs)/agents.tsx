import { router } from 'expo-router';
import { ArrowUpRight } from 'phosphor-react-native/src/icons/ArrowUpRight';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { PlugsConnected } from 'phosphor-react-native/src/icons/PlugsConnected';
import { XCircle } from 'phosphor-react-native/src/icons/XCircle';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { AgentRow } from '@/components/agents/agent-row';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { Chip, EmptyState, LargeTitleScreen, RowSkeleton, SectionHeader } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { useAgentCounts, useAgentTools, type AgentKind, type AgentTool } from '@/lib/agents';
import { compactNumber } from '@/lib/format';
import { friendlyError } from '@/lib/supabase';
import { fonts, radius, space, useColors } from '@/theme';

const KINDS: { key: AgentKind; label: string; section: string; blurb: string }[] = [
  { key: 'skill', label: 'Skills', section: 'Skills', blurb: 'Instructions and scripts that teach an agent a task. Work in Claude Code, Codex and more.' },
  { key: 'plugin', label: 'Plugins', section: 'Claude Code plugins', blurb: 'Commands, agents, skills and MCP servers bundled for Claude Code.' },
  { key: 'mcp', label: 'MCP servers', section: 'MCP servers', blurb: 'Connect an agent to apps, APIs and data. From the official MCP registry.' },
];

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Rows({ tools }: { tools: AgentTool[] }) {
  return (
    <>
      {tools.map((t, i) => (
        <View key={t.id}>
          {i > 0 ? <DotRule style={{ marginLeft: space.gutter + 66, width: '78%' }} /> : null}
          <AgentRow tool={t} />
        </View>
      ))}
    </>
  );
}

/** One kind's top entries, with "See all". */
function Section({ kind, onAll }: { kind: (typeof KINDS)[number]; onAll: () => void }) {
  const tools = useAgentTools('', kind.key, 6);
  return (
    <View style={{ marginBottom: 26 }}>
      <SectionHeader title={kind.section} action="See all" onAction={onAll} />
      <Txt variant="callout" color="text2" style={{ paddingHorizontal: space.gutter, marginBottom: 6 }}>
        {kind.blurb}
      </Txt>
      {tools.isLoading ? <RowSkeleton count={3} /> : <Rows tools={tools.data ?? []} />}
    </View>
  );
}

/** Skills, Claude Code plugins and MCP servers for AI agents, with install commands for each. */
export default function AgentsScreen() {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AgentKind | null>(null);
  const term = useDebounced(query.trim());
  const browsing = !term && !kind;
  const results = useAgentTools(term, kind, 50);
  const counts = useAgentCounts();
  const n = counts.data ?? {};

  const refresh = () => {
    counts.refetch();
    results.refetch();
  };

  return (
    <LargeTitleScreen
      title="Agents"
      eyebrow="For Claude, Codex and other AI agents"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshing={results.isRefetching}
      onRefresh={refresh}
    >
      {counts.data ? (
        <Txt variant="mono" color="text2" style={{ paddingHorizontal: space.gutter, marginTop: -8, marginBottom: 16 }}>
          {`${compactNumber(n.skill ?? 0)} skills  ·  ${compactNumber(n.plugin ?? 0)} plugins  ·  ${compactNumber(n.mcp ?? 0)} MCP servers`}
        </Txt>
      ) : null}

      <View
        style={{
          marginHorizontal: space.gutter,
          marginBottom: 14,
          height: 48,
          borderRadius: radius.input,
          backgroundColor: c.surface2,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          gap: 10,
        }}
      >
        <MagnifyingGlass size={20} color={c.text2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="PDF, Postgres, code review, design…"
          placeholderTextColor={c.text3}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search skills, plugins and MCP servers"
          selectionColor={c.accent}
          style={{ flex: 1, color: c.text, fontFamily: fonts.sans, fontSize: 16, height: 48 }}
        />
        {query ? (
          <Tap onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <XCircle size={20} color={c.text3} weight="fill" />
          </Tap>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: space.gutter, marginBottom: 22 }}>
        <Chip label="All" active={kind === null} onPress={() => setKind(null)} />
        {KINDS.map((k) => (
          <Chip key={k.key} label={k.label} active={kind === k.key} onPress={() => setKind(k.key)} />
        ))}
      </View>

      {browsing ? (
        <>
          <Tap
            onPress={() => router.push('/agents/connect')}
            accessibilityRole="link"
            accessibilityLabel="Connect your agent to ArkStore"
            style={{ marginHorizontal: space.gutter, marginBottom: 28, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', padding: 18, gap: 8 }}
          >
            <DotGrid gap={12} size={1.2} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <PlugsConnected size={26} color={c.accent} />
              <Txt variant="headline" style={{ flex: 1 }}>
                Connect your agent to ArkStore
              </Txt>
              <ArrowUpRight size={18} color={c.text2} />
            </View>
            <Txt variant="callout" color="text2">
              Let Claude or Codex search ArkStore, check whether an app already exists before building it, and publish your apps for you.
            </Txt>
          </Tap>
          {KINDS.map((k) => (
            <Section key={k.key} kind={k} onAll={() => setKind(k.key)} />
          ))}
        </>
      ) : results.isLoading ? (
        <RowSkeleton count={8} />
      ) : results.error ? (
        <EmptyState glyph="!?" title="Couldn't load" body={friendlyError(results.error)} />
      ) : (results.data ?? []).length === 0 ? (
        <EmptyState glyph="0" title="Nothing found" body="Try other words, like what it should connect to or do." />
      ) : (
        <Rows tools={results.data!} />
      )}
    </LargeTitleScreen>
  );
}
