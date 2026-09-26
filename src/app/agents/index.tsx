import { router } from 'expo-router';
import { ArrowUpRight } from 'phosphor-react-native/src/icons/ArrowUpRight';
import { MagnifyingGlass } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { PlugsConnected } from 'phosphor-react-native/src/icons/PlugsConnected';
import { XCircle } from 'phosphor-react-native/src/icons/XCircle';
import { useEffect, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';

import { AgentRow } from '@/components/agents/agent-row';
import { DotGrid, DotRule } from '@/components/ui/dots';
import { Chip, EmptyState, RowSkeleton } from '@/components/ui/layout';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { TopBar } from '@/components/ui/top-bar';
import { useAgentTools, type AgentKind } from '@/lib/agents';
import { friendlyError } from '@/lib/supabase';
import { fonts, radius, space, useColors } from '@/theme';

const KINDS: { key: AgentKind | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'mcp', label: 'MCP servers' },
  { key: 'plugin', label: 'Claude Code plugins' },
];

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** MCP servers and Claude Code plugins, with install commands for Claude Code, Codex and Claude Desktop. */
export default function AgentsScreen() {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AgentKind | null>(null);
  const term = useDebounced(query.trim());
  const tools = useAgentTools(term, kind);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar />
      <FlatList
        data={tools.data ?? []}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 60 }}
        ListHeaderComponent={
          <View style={{ gap: 18, marginBottom: 10 }}>
            <View style={{ paddingHorizontal: space.gutter, gap: 6 }}>
              <Txt variant="label" color="text2">
                For Claude, Codex and other agents
              </Txt>
              <Txt variant="display" accessibilityRole="header">
                AI agents
              </Txt>
              <Txt variant="callout" color="text2">
                MCP servers from the official MCP registry and Claude Code plugins, with the exact command to install each one.
              </Txt>
            </View>

            <Tap
              onPress={() => router.push('/agents/connect')}
              accessibilityRole="link"
              accessibilityLabel="Connect your AI agent to ArkStore"
              style={{ marginHorizontal: space.gutter, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', padding: 18, gap: 8 }}
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

            <View
              style={{
                marginHorizontal: space.gutter,
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
                placeholder="Postgres, browser automation, code review…"
                placeholderTextColor={c.text3}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Search MCP servers and plugins"
                selectionColor={c.accent}
                style={{ flex: 1, color: c.text, fontFamily: fonts.sans, fontSize: 16, height: 48 }}
              />
              {query ? (
                <Tap onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <XCircle size={20} color={c.text3} weight="fill" />
                </Tap>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: space.gutter }}>
              {KINDS.map((k) => (
                <Chip key={k.label} label={k.label} active={kind === k.key} onPress={() => setKind(k.key)} />
              ))}
            </View>
          </View>
        }
        ItemSeparatorComponent={() => <DotRule style={{ marginLeft: space.gutter + 66, width: '78%' }} />}
        renderItem={({ item }) => <AgentRow tool={item} />}
        ListEmptyComponent={
          tools.isLoading ? (
            <RowSkeleton count={8} />
          ) : tools.error ? (
            <EmptyState glyph="!?" title="Couldn't load" body={friendlyError(tools.error)} />
          ) : (
            <EmptyState glyph="0" title="Nothing found" body="Try other words, like what the server should connect to." />
          )
        }
      />
    </View>
  );
}
