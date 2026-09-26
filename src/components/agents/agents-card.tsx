import { router } from 'expo-router';
import { ArrowUpRight } from 'phosphor-react-native/src/icons/ArrowUpRight';
import { PlugsConnected } from 'phosphor-react-native/src/icons/PlugsConnected';
import { Robot } from 'phosphor-react-native/src/icons/Robot';
import { View } from 'react-native';

import { DotGrid } from '@/components/ui/dots';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { radius, space, useColors } from '@/theme';

const COPY = {
  browse: {
    href: '/agents',
    icon: Robot,
    eyebrow: 'For AI agents',
    title: 'MCP servers & Claude Code plugins',
    body: 'Thousands of tools for Claude, Codex and other agents, with the command to install each one.',
  },
  connect: {
    href: '/agents/connect',
    icon: PlugsConnected,
    eyebrow: 'ArkStore MCP server',
    title: 'Connect your AI agent',
    body: 'Let Claude or Codex check whether an app already exists before building it, and publish your apps for you.',
  },
} as const;

export function AgentsCard({ variant }: { variant: keyof typeof COPY }) {
  const c = useColors();
  const k = COPY[variant];
  const Glyph = k.icon;
  return (
    <Tap
      onPress={() => router.push(k.href)}
      accessibilityRole="link"
      accessibilityLabel={k.title}
      style={{ marginHorizontal: space.gutter, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden', padding: 18, gap: 6 }}
    >
      <DotGrid gap={12} size={1.2} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Glyph size={26} color={c.accent} />
        <View style={{ flex: 1 }}>
          <Txt variant="label" color="text2">
            {k.eyebrow}
          </Txt>
          <Txt variant="headline">{k.title}</Txt>
        </View>
        <ArrowUpRight size={18} color={c.text2} />
      </View>
      <Txt variant="callout" color="text2">
        {k.body}
      </Txt>
    </Tap>
  );
}
