import * as Clipboard from 'expo-clipboard';
import { Check } from 'phosphor-react-native/src/icons/Check';
import { Copy } from 'phosphor-react-native/src/icons/Copy';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Tap } from '@/components/ui/tap';
import { Txt } from '@/components/ui/text';
import { radius, useColors } from '@/theme';

/** A command or config snippet with a copy button. Long lines scroll sideways instead of wrapping. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const c = useColors();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
  };

  const Glyph = copied ? Check : Copy;
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Txt variant="caption" color="text2">
          {label}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: c.surface, borderRadius: radius.input, borderWidth: 1, borderColor: c.line }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
          <Txt variant="mono" selectable style={{ fontSize: 12.5, lineHeight: 18 }}>
            {code}
          </Txt>
        </ScrollView>
        <Tap
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Copied' : `Copy ${label ?? 'command'}`}
          style={{ padding: 12 }}
        >
          <Glyph size={18} color={copied ? c.accent : c.text2} />
        </Tap>
      </View>
    </View>
  );
}
