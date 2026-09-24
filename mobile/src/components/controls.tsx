import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, space, type } from '../design/tokens';

export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  disabled?: boolean;
  dark?: boolean;
  variant?: 'filled' | 'outlined';
}) {
  const outlined = props.variant === 'outlined';
  const foreground = outlined ? color.action : color.surface;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled || props.busy), busy: props.busy }}
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.primary,
        props.dark && styles.primaryDark,
        outlined && styles.outlined,
        (props.disabled || props.busy) && styles.disabled,
        pressed && styles.pressed,
        pressed && outlined && styles.outlinedPressed,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.buttonContent}>
          {props.icon && <Ionicons name={props.icon} size={21} color={foreground} />}
          <Text style={[styles.primaryText, outlined && styles.outlinedText]}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export const IconButton = forwardRef<View, {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  inverted?: boolean;
  selected?: boolean;
  disabled?: boolean;
}>(function IconButton(props, ref) {
  const foreground = props.inverted ? color.cameraText : color.ink;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      hitSlop={8}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.iconButton,
        props.inverted && styles.iconButtonInverted,
        props.selected && styles.iconButtonSelected,
        props.disabled && styles.disabled,
        pressed && styles.iconPressed,
      ]}
    >
      <Ionicons name={props.icon} size={23} color={foreground} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  primary: {
    alignItems: 'center',
    backgroundColor: color.action,
    borderRadius: radius.control,
    minHeight: 54,
    paddingVertical: 14,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    shadowColor: color.ink,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0,
    shadowRadius: 5,
    elevation: 0,
  },
  primaryDark: { shadowColor: color.camera },
  outlined: { backgroundColor: color.canvas, borderColor: color.action, borderWidth: 1 },
  outlinedText: { color: color.action },
  outlinedPressed: { backgroundColor: color.actionSoft },
  primaryText: { color: color.surface, fontFamily: type.ticketBold, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
  buttonContent: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  disabled: { opacity: 0.45 },
  pressed: { backgroundColor: color.actionPressed, transform: [{ translateY: 1 }] },
  iconButton: {
    alignItems: 'center',
    borderRadius: radius.round,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  iconButtonInverted: { backgroundColor: color.cameraChrome },
  iconButtonSelected: { backgroundColor: color.action },
  iconPressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },
});
