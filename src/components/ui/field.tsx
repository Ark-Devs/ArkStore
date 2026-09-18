import { TextInput, View, type TextInputProps } from 'react-native';

import { fonts, radius, useColors } from '@/theme';

import { Txt } from './text';

/** Label above, input, then helper or error below. Shows a counter when there's a limit. */
export function Field({
  label,
  value,
  onChangeText,
  maxLength,
  helper,
  error,
  multiline,
  ...input
}: TextInputProps & { label: string; value: string; helper?: string; error?: string | null }) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="label" color="text2">
          {label}
        </Txt>
        {maxLength ? (
          <Txt variant="mono" color={value.length > maxLength * 0.9 ? 'accent' : 'text3'} style={{ fontSize: 11 }}>
            {value.length}/{maxLength}
          </Txt>
        ) : null}
      </View>
      <TextInput
        {...input}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={{
          minHeight: multiline ? 150 : 50,
          borderRadius: radius.input,
          backgroundColor: c.surface2,
          borderWidth: 1,
          borderColor: error ? c.accent : c.surface2,
          paddingHorizontal: 14,
          paddingTop: multiline ? 12 : 0,
          paddingBottom: multiline ? 12 : 0,
          color: c.text,
          fontFamily: fonts.sans,
          fontSize: 15,
          lineHeight: multiline ? 21 : undefined,
        }}
      />
      {error ? (
        <Txt variant="caption" color="accent">
          {error}
        </Txt>
      ) : helper ? (
        <Txt variant="caption" color="text3">
          {helper}
        </Txt>
      ) : null}
    </View>
  );
}
