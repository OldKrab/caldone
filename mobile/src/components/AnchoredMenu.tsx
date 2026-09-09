import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { color, radius, space, type } from '../design/tokens';
import { t } from '../i18n';

export type MenuAnchor = { x: number; y: number; width: number; height: number };
export type AnchoredMenuItem = { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void | Promise<void> };

export function AnchoredMenu(props: {
  anchor?: MenuAnchor;
  items: AnchoredMenuItem[];
  onClose: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const menuHeight = props.items.length * 52 + space.xs * 2;
  const top = Math.min((props.anchor?.y ?? 0) + (props.anchor?.height ?? 0) + 4, height - menuHeight - space.md);
  const right = Math.max(space.sm, width - ((props.anchor?.x ?? width) + (props.anchor?.width ?? 0)));

  return (
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={props.onClose} statusBarTranslucent transparent visible={Boolean(props.anchor)}>
      <View accessibilityViewIsModal style={styles.overlay}>
        <Pressable accessibilityLabel={t('close')} accessibilityRole="button" onPress={props.onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.menu, { right, top }]}>
          {props.items.map((item) => (
            <Pressable
              accessibilityRole="menuitem"
              key={item.label}
              onPress={() => { props.onClose(); void item.onPress(); }}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            >
              {item.icon ? <Ionicons name={item.icon} color={color.muted} size={19} /> : null}
              <Text style={styles.label}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  menu: {
    backgroundColor: color.surface,
    borderRadius: radius.control,
    elevation: 7,
    minWidth: 232,
    overflow: 'hidden',
    paddingVertical: space.xs,
    position: 'absolute',
    shadowColor: color.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  item: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: space.md },
  itemPressed: { backgroundColor: color.surfacePressed },
  label: { color: color.ink, fontFamily: type.ticketBold, fontSize: 17 },
});
