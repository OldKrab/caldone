import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { IconButton, PrimaryButton } from '../../components/controls';
import { KeyboardSafeArea } from '../../components/KeyboardSafeArea';
import { color, motion, radius, space, type } from '../../design/tokens';
import type { MealPhoto } from '../../domain/meal';
import { formatPhotoCount, locale, t } from '../../i18n';

export function CaptureReviewScreen(props: {
  addingDish?: boolean;
  photos: MealPhoto[];
  note: string;
  sending: boolean;
  error?: string;
  onNoteChange: (note: string) => void;
  onAddPhoto: () => void;
  onRemovePhoto: (index: number) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const [selected, setSelected] = useState(props.photos.length - 1);
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setSelected((current) => Math.min(current, props.photos.length - 1));
  }, [props.photos.length]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) return reveal.setValue(1);
      Animated.timing(reveal, {
        duration: motion.screen,
        easing: motion.easeOut,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    });
  }, [reveal]);

  const photo = props.photos[selected] ?? props.photos[0];

  return (
    <KeyboardSafeArea backgroundColor={color.camera}>
        <Animated.View style={[
          styles.screen,
          { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
        ]}>
          <View style={styles.header}>
            <IconButton icon="close" inverted label={t('close')} disabled={props.sending} onPress={props.onCancel} />
            <Text selectable adjustsFontSizeToFit minimumFontScale={0.86} numberOfLines={1} style={styles.headerTitle}>{props.addingDish ? t('addDish') : locale === 'ru' ? 'Всё видно?' : 'All in the frame?'}</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.previewFrame}>
            {photo && <Image source={{ uri: photo.uri }} resizeMode="contain" style={styles.preview} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('removePhoto')}
              disabled={props.sending}
              onPress={() => props.onRemovePhoto(selected)}
              style={({ pressed }) => [styles.previewRemove, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={20} color={color.cameraText} />
            </Pressable>
          </View>

          {props.photos.length > 1 && <ScrollView
            horizontal
            contentContainerStyle={styles.thumbnails}
            showsHorizontalScrollIndicator={false}
            style={styles.thumbnailsRow}
          >
              {props.photos.map((item, index) => (
                <Pressable
                  key={`${item.uri}-${index}`}
                  accessibilityRole="button"
                  onPress={() => setSelected(index)}
                  style={[styles.thumbnailFrame, selected === index && styles.thumbnailSelected]}
                >
                  <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                </Pressable>
              ))}
          </ScrollView>}

          <View style={styles.composer}>
            <View style={styles.composerHeading}>
              <Text selectable style={styles.composerLabel}>{locale === 'ru' ? 'Есть что уточнить?' : 'Anything to add?'}</Text>
              <Text selectable style={styles.composerCount}>{formatPhotoCount(props.photos.length)}</Text>
            </View>
            <TextInput
              editable={!props.sending}
              maxLength={300}
              onChangeText={props.onNoteChange}
              placeholder={t('notePlaceholder')}
              placeholderTextColor={color.cameraMuted}
              style={styles.input}
              value={props.note}
            />
            {props.error && <Text selectable style={styles.error}>{props.error}</Text>}
            {props.addingDish && <Text selectable accessibilityLiveRegion="polite" style={styles.additionHelp}>{t(props.sending ? 'addingDish' : 'addDishHelp')}</Text>}
            <PrimaryButton
              busy={props.sending}
              disabled={props.photos.length === 0}
              icon="checkmark"
              label={props.addingDish ? t('addDish') : locale === 'ru' ? 'Добавить и распознать' : 'Log this meal'}
              onPress={props.onSend}
            />
            <Pressable
              accessibilityRole="button"
              onPress={props.onAddPhoto}
              disabled={props.sending}
              style={({ pressed }) => [styles.addAngle, pressed && styles.pressed]}
            >
              <Ionicons name="camera-outline" size={20} color={color.cameraText} />
              <Text style={styles.addAngleText}>{t('addAnotherAngle')}</Text>
            </Pressable>
          </View>
        </Animated.View>
    </KeyboardSafeArea>
  );
}

const styles = StyleSheet.create({
  additionHelp: { color: color.cameraMuted, fontSize: 14, lineHeight: 20 },
  safeArea: { backgroundColor: color.camera, flex: 1 },
  screen: { flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.sm },
  headerSpacer: { width: 48 },
  headerTitle: { color: color.cameraText, flex: 1, fontFamily: type.ticketBold, fontSize: 20, textAlign: 'center' },
  previewFrame: { backgroundColor: color.camera, borderRadius: radius.image, flex: 1, marginHorizontal: 20, overflow: 'hidden' },
  preview: { height: '100%', width: '100%' },
  previewRemove: { alignItems: 'center', backgroundColor: color.cameraChrome, borderRadius: radius.control, height: 48, justifyContent: 'center', position: 'absolute', right: space.sm, top: space.sm, width: 48 },
  thumbnailsRow: { flexGrow: 0, marginTop: space.md, minHeight: 62 },
  thumbnails: { alignItems: 'center', gap: space.sm, paddingHorizontal: 20 },
  thumbnailFrame: { borderColor: 'transparent', borderRadius: radius.image, borderWidth: 2, height: 58, overflow: 'hidden', width: 58 },
  thumbnailSelected: { borderColor: color.action },
  thumbnail: { height: '100%', width: '100%' },
  addThumbnail: { alignItems: 'center', backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.control, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: 7, height: 56, paddingHorizontal: 14 },
  addThumbnailText: { color: color.ink, fontFamily: type.ticket, fontSize: 15 },
  composer: { gap: 10, marginHorizontal: 20, marginBottom: 12, marginTop: 18 },
  composerHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: space.sm },
  composerLabel: { color: color.cameraText, fontFamily: type.ticketBold, fontSize: 14, letterSpacing: 0.8 },
  composerCount: { color: color.cameraMuted, fontFamily: type.ticket, fontSize: 13 },
  input: { backgroundColor: color.cameraInput, borderColor: color.cameraLine, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, color: color.cameraText, fontSize: 15, height: 50, paddingHorizontal: 16 },
  addAngle: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50 },
  addAngleText: { color: color.cameraText, fontFamily: type.ticketBold, fontSize: 14 },
  error: { color: color.error, fontSize: 13 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.96 }] },
});
