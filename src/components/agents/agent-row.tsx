import { router } from 'expo-router';
import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { installSummary } from '@/lib/agent-install';
import type { AgentTool } from '@/lib/agents';
import { space } from '@/theme';

export function AgentRow({ tool }: { tool: AgentTool }) {
  return (
    <Tap
      scale={0.98}
      onPress={() => router.push(`/agents/${tool.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`${tool.title}. ${tool.description}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.gutter, paddingVertical: 8 }}
    >
      <AppIcon uri={tool.icon_url} name={tool.title} size={52} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {tool.title}
          </Txt>
          {tool.featured ? (
            <Txt variant="label" color="accent" style={{ fontSize: 8.5 }}>
              Featured
            </Txt>
          ) : null}
        </View>
        <Txt variant="callout" color="text2" numberOfLines={2}>
          {tool.description || tool.publisher || tool.name}
        </Txt>
        <Txt variant="mono" color="text3" numberOfLines={1} style={{ marginTop: 2, fontSize: 11 }}>
          {[installSummary(tool), tool.publisher].filter(Boolean).join('  ·  ')}
        </Txt>
      </View>
    </Tap>
  );
}
