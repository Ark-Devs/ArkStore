import { useState } from 'react';
import { View } from 'react-native';

import { Chip } from '@/components/ui/layout';
import { Txt } from '@/components/ui/text';
import { CLIENT_LABEL, installGuides, type AgentToolLike, type InstallClient, type InstallGuide } from '@/lib/agent-install';

import { CodeBlock } from './code-block';

export function GuideSteps({ guide }: { guide: InstallGuide }) {
  return (
    <View style={{ gap: 14 }}>
      {guide.steps.map((step, i) =>
        step.code ? (
          <CodeBlock key={i} code={step.code} label={step.file ? `${step.label} (${step.file})` : step.label} />
        ) : (
          <Txt key={i} variant="callout" color="text2">
            {step.label}
          </Txt>
        ),
      )}
    </View>
  );
}

/** Pick Claude Code, Codex or Claude Desktop and get that client's commands. */
export function InstallGuideTabs({ tool }: { tool: AgentToolLike }) {
  const guides = installGuides(tool);
  const first = guides.find((g) => g.supported)?.client ?? 'claude-code';
  const [client, setClient] = useState<InstallClient>(first);
  const guide = guides.find((g) => g.client === client) ?? guides[0];
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {guides.map((g) => (
          <Chip
            key={g.client}
            label={CLIENT_LABEL[g.client]}
            active={g.client === client}
            onPress={() => setClient(g.client)}
          />
        ))}
      </View>
      <GuideSteps guide={guide} />
    </View>
  );
}
