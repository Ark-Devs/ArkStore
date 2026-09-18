import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** How far the element sinks when pressed (App Store cards use ~0.97). */
  scale?: number;
};

/** Pressable with a physical press: slight shrink and dim. */
export function Tap({ style, scale = 0.97, disabled, ...rest }: Props) {
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={({ pressed }) => [
        style,
        disabled ? { opacity: 0.45 } : null,
        pressed && !disabled ? { transform: [{ scale }], opacity: 0.85 } : null,
      ]}
    />
  );
}
