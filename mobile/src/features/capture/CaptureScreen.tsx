import { chooseZoom, parseCameraLenses, zoomStops, type CameraLens } from './cameraZoom';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '../../components/controls';
import { color, radius, space, type } from '../../design/tokens';
import type { MealPhoto } from '../../domain/meal';
import { appendDiagnosticEvent } from '../../data/mealRepository';
import { t } from '../../i18n';

export function CaptureScreen(props: {
  photos: MealPhoto[];
  error?: string;
  onDescribe: () => void;
  onCancel: () => void;
  onCaptured: (photo: MealPhoto) => void;
}) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [lenses, setLenses] = useState<CameraLens[]>([]);
  const [factor, setFactor] = useState(1);
  const zoom = chooseZoom(lenses, factor);
  const pinch = useRef({ distance: 0, factor: 1 });
  const distance = (touches: readonly { pageX: number; pageY: number }[]) => touches.length < 2 ? 0 : Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  const setZoom = (value: number) => {
    const next = chooseZoom(lenses, value);
    if (next && !taking) setFactor(next.factor);
  };
  const gestures = PanResponder.create({
    onStartShouldSetPanResponder: event => event.nativeEvent.touches.length === 2 && !taking,
    onMoveShouldSetPanResponder: event => event.nativeEvent.touches.length === 2 && !taking,
    onPanResponderGrant: event => { pinch.current = { distance: distance(event.nativeEvent.touches), factor }; },
    onPanResponderMove: event => {
      const current = distance(event.nativeEvent.touches);
      if (current && pinch.current.distance) setZoom(pinch.current.factor * current / pinch.current.distance);
    },
  });
  const cameraReady = async () => {
    setReady(true);
    let available: CameraLens[] = [];
    let capabilityError: string | undefined;
    try {
      available = parseCameraLenses(await camera.current?.getAvailableLensesAsync() ?? []);
      if (!available.length) capabilityError = 'Camera returned no lens capabilities';
    } catch (error) { capabilityError = String(error); }
    setLenses(available);
    void appendDiagnosticEvent({
      id: `${Date.now().toString(36)}-camera-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(), operation: 'camera', lenses: available, error: capabilityError,
    }).catch(() => undefined);
  };
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [error, setError] = useState('');

  const capture = async () => {
    if (!ready || taking) return;
    setTaking(true);
    setError('');
    try {
      const result = await camera.current?.takePictureAsync({ quality: 0.72, shutterSound: false });
      if (!result?.uri) throw new Error('Camera returned no image');
      props.onCaptured(newPhoto(result.uri, 'image/jpeg'));
    } catch {
      setError(t('captureError'));
      setTaking(false);
    }
  };

  const chooseExisting = async () => {
    if (taking) return;
    setTaking(true);
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        orderedSelection: true,
        quality: 0.72,
        selectionLimit: 0,
      });
      if (!result.canceled) {
        for (const asset of result.assets) {
          props.onCaptured(newPhoto(asset.uri, asset.mimeType ?? 'image/jpeg'));
        }
      }
    } catch {
      setError(t('galleryError'));
    } finally {
      setTaking(false);
    }
  };

  if (!permission) {
    return <View style={styles.permission}><ActivityIndicator color={color.action} /></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission}>
        <View style={styles.permissionIcon}>
          <Ionicons name="camera-outline" size={30} color={color.ink} />
        </View>
        <Text selectable style={styles.permissionTitle}>{t('cameraPermissionTitle')}</Text>
        <Text selectable style={styles.permissionBody}>{t('cameraPermissionBody')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={requestPermission}
          style={({ pressed }) => [styles.permissionAction, pressed && styles.pressed]}
        >
          <Text style={styles.permissionActionText}>{t('allowCamera')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void chooseExisting()}
          style={({ pressed }) => [styles.galleryPermissionAction, pressed && styles.pressed]}
        >
          <Ionicons name="images-outline" size={20} color={color.action} />
          <Text style={styles.galleryPermissionText}>{t('chooseExistingPhoto')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={props.onDescribe}
          style={({ pressed }) => [styles.galleryPermissionAction, pressed && styles.pressed]}
        >
          <Ionicons name="create-outline" size={20} color={color.action} />
          <Text style={styles.galleryPermissionText}>{t('describeMeal')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onCancel} hitSlop={12}>
          <Text style={styles.cancel}>{t('close')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <CameraView
        ref={camera}
        facing="back"
        ratio="4:3"
        selectedLens={zoom?.id}
        zoom={zoom?.zoom ?? 0}
        flash={flash}
        onCameraReady={() => void cameraReady()}
        onMountError={() => { setReady(false); setError(t('captureError')); }}
        style={StyleSheet.absoluteFill}
      />
      <View style={StyleSheet.absoluteFill} {...gestures.panHandlers} />
      <SafeAreaView style={styles.chrome} pointerEvents="box-none">
        <View style={styles.topBar}>
          <IconButton icon="close" label={t('close')} inverted onPress={props.onCancel} />
          <Text selectable style={styles.cameraTitle}>{props.photos.length > 0 ? t('addPhoto') : t('addMeal')}</Text>
          <IconButton
            icon={flash === 'on' ? 'flash' : 'flash-off'}
            label={flash === 'on' ? t('flashOn') : t('flashOff')}
            inverted
            selected={flash === 'on'}
            onPress={() => setFlash((current) => current === 'on' ? 'off' : 'on')}
          />
        </View>
        <View pointerEvents="box-none">
          {lenses.length > 0 && <View style={styles.zoomRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('zoomOut')} disabled={taking} onPress={() => setZoom(factor / 1.2)} style={styles.zoomButton}><Text style={styles.zoomText}>−</Text></Pressable>
            {zoomStops(lenses).map(stop => <Pressable key={stop} accessibilityRole="button" accessibilityLabel={`${stop}×`} accessibilityState={{ selected: Math.abs(factor-stop) < 0.06 }} disabled={taking} onPress={() => setZoom(stop)} style={[styles.zoomButton, Math.abs(factor-stop) < 0.06 && styles.zoomSelected]}><Text style={styles.zoomText}>{stop}×</Text></Pressable>)}
            <Pressable accessibilityRole="button" accessibilityLabel={t('zoomIn')} disabled={taking} onPress={() => setZoom(factor * 1.2)} style={styles.zoomButton}><Text style={styles.zoomText}>+</Text></Pressable>
          </View>}
          {lenses.length > 0 && <Text style={styles.zoomValue}>{factor.toFixed(1)}×</Text>}
        <View style={styles.bottomBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chooseExistingPhoto')}
            disabled={taking}
            onPress={() => void chooseExisting()}
            style={({ pressed }) => [styles.galleryButton, taking && styles.shutterDisabled, pressed && styles.galleryButtonPressed]}
          >
            <Ionicons name="images-outline" size={24} color={color.cameraText} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('takePhoto')}
            disabled={!ready || taking}
            onPress={capture}
            style={({ pressed }) => [
              styles.shutterOuter,
              (!ready || taking) && styles.shutterDisabled,
              pressed && styles.shutterPressed,
            ]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          {props.photos.length > 0 ? (
            <Text style={styles.photoCount}>{props.photos.length + 1}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('describeMeal')}
              onPress={props.onDescribe}
              style={({ pressed }) => [styles.manualButton, pressed && styles.galleryButtonPressed]}
            >
              <Ionicons name="create-outline" size={23} color={color.cameraText} />
            </Pressable>
          )}
          {(error || props.error) && <Text selectable style={styles.error}>{error || props.error}</Text>}
        </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function newPhoto(uri: string, mimeType: string): MealPhoto {
  const createdAt = Date.now();
  return { id: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 9)}`, uri, mimeType, createdAt };
}

const styles = StyleSheet.create({
  zoomRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  zoomButton: { minWidth: 44, height: 44, borderRadius: 22, backgroundColor: color.cameraChrome, alignItems: 'center', justifyContent: 'center' },
  zoomSelected: { backgroundColor: color.action },
  zoomText: { color: color.cameraText, fontSize: 16, fontFamily: type.ticketBold },
  zoomValue: { color: color.cameraText, textAlign: 'center', fontSize: 12, marginTop: 6 },
  screen: { backgroundColor: color.camera, flex: 1 },
  chrome: { flex: 1, justifyContent: 'space-between' },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md, paddingTop: space.sm },
  cameraTitle: { backgroundColor: color.cameraChrome, borderRadius: radius.control, color: color.cameraText, fontFamily: type.ticketBold, fontSize: 18, overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 8 },
  bottomBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 28, paddingHorizontal: space.xl, paddingTop: 14 },
  shutterOuter: { alignItems: 'center', borderColor: color.cameraText, borderRadius: 42, borderWidth: 4, height: 82, justifyContent: 'center', width: 82 },
  shutterInner: { backgroundColor: color.cameraText, borderRadius: 34, height: 64, width: 64 },
  shutterDisabled: { opacity: 0.45 },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  error: { backgroundColor: color.cameraChrome, borderRadius: radius.sm, bottom: 122, color: color.cameraText, fontSize: 12, left: space.xl, padding: space.sm, position: 'absolute', right: space.xl, textAlign: 'center' },
  photoCount: { color: color.cameraText, fontFamily: type.ticketBold, fontSize: 16, textAlign: 'center', width: 64 },
  manualButton: { alignItems: 'center', backgroundColor: color.cameraChrome, borderRadius: radius.control, height: 48, justifyContent: 'center', width: 64 },
  permission: { alignItems: 'center', backgroundColor: color.canvas, flex: 1, justifyContent: 'center', padding: space.xl },
  permissionIcon: { alignItems: 'center', backgroundColor: color.surface, borderColor: color.line, borderRadius: radius.surface, borderStyle: 'dashed', borderWidth: 1, height: 68, justifyContent: 'center', width: 68 },
  permissionTitle: { color: color.ink, fontFamily: type.ticketBold, fontSize: 27, marginTop: space.lg },
  permissionBody: { color: color.muted, fontSize: 15, lineHeight: 22, marginTop: space.sm, maxWidth: 310, textAlign: 'center' },
  permissionAction: { backgroundColor: color.action, borderRadius: radius.control, justifyContent: 'center', marginTop: space.xl, minHeight: 52, paddingHorizontal: 24 },
  permissionActionText: { color: color.surface, fontFamily: type.ticketBold, fontSize: 18 },
  galleryPermissionAction: { alignItems: 'center', flexDirection: 'row', gap: space.sm, marginTop: space.lg, minHeight: 44, paddingHorizontal: 12 },
  galleryPermissionText: { color: color.action, fontFamily: type.ticketBold, fontSize: 16 },
  cancel: { color: color.muted, fontSize: 15, marginTop: space.lg },
  galleryButton: { alignItems: 'center', backgroundColor: color.cameraChrome, borderRadius: radius.control, height: 48, justifyContent: 'center', width: 64 },
  galleryButtonPressed: { opacity: 0.72, transform: [{ scale: 0.94 }] },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
});
