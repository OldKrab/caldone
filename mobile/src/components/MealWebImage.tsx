import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, space } from '../design/tokens';
import { parseMealWebImage, type MealWebImage as WebImage } from '../domain/mealWebImage';
import { t } from '../i18n';
import { useAppDialog } from './AppDialog';

/** Web artwork never gets the save/share actions belonging to user photos. */
export function MealWebImage(props: { image: WebImage; compact?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const dialog = useAppDialog();
  const image = parseMealWebImage(props.image);
  if (!image || failedUrl === image.url) {
    return props.compact ? <View style={styles.placeholder}><Ionicons name="restaurant-outline" size={24} color={color.action} /></View> : null;
  }
  const openSource = async () => {
    try { await Linking.openURL(image.sourceUrl); }
    catch {
      dialog.show({ title: t('webImageSource'), message: t('webImageSourceError'), actions: [{ label: t('close'), role: 'cancel' }] });
    }
  };
  return (
    <View style={props.compact ? styles.thumbnail : styles.detail}>
      <Image
        accessibilityLabel={t('webImageLabel')}
        source={{ uri: image.url }}
        resizeMode="cover"
        style={props.compact ? styles.thumbnail : styles.image}
        onError={() => setFailedUrl(image.url)}
      />
      {props.compact ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{t('webImageShort')}</Text></View>
      ) : (
        <Pressable accessibilityRole="link" accessibilityLabel={`${t('webImageSource')}: ${new URL(image.sourceUrl).hostname}`} onPress={openSource} style={({ pressed }) => [styles.source, pressed && styles.pressed]}>
          <Ionicons name="globe-outline" size={16} color={color.action} />
          <View style={styles.sourceCopy}>
            <Text style={styles.label}>{t('webImageLabel')}</Text>
            <Text numberOfLines={1} style={styles.host}>{new URL(image.sourceUrl).hostname}</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={color.action} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { width: '100%', maxWidth: 260, marginBottom: space.md },
  image: { width: '100%', height: 138, borderRadius: radius.image, backgroundColor: color.actionSoft },
  thumbnail: { width: 68, height: 76, borderRadius: radius.image, backgroundColor: color.actionSoft },
  placeholder: { width: 68, height: 76, borderRadius: radius.image, backgroundColor: color.actionSoft, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', bottom: 4, left: 4, right: 4, alignItems: 'center', borderRadius: radius.sm, backgroundColor: color.surface },
  badgeText: { color: color.muted, fontSize: 11, paddingVertical: 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingVertical: space.sm },
  sourceCopy: { flex: 1 },
  label: { color: color.muted, fontSize: 12 },
  host: { color: color.action, fontSize: 12, marginTop: 2, textDecorationLine: 'underline' },
  pressed: { opacity: 0.7 },
});
