import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../components/controls';
import { color, space, type } from '../../design/tokens';
import { locale, t } from '../../i18n';
import type { AppUpdates } from './useAppUpdates';

export function UpdateSettings({ updates }: { updates: AppUpdates }) {
  const { result, install } = updates;
  const downloading = install.status === 'downloading';
  const staged = ['ready', 'installing', 'confirmation'].includes(install.status);
  return <View style={styles.content}>
    <Text selectable style={styles.version}>{t('versionLabel', { version: updates.installedVersion })}</Text>
    <Text selectable style={styles.copy}>{t('updateSchedule')}</Text>
    {result?.checkedAt ? <Text selectable style={styles.copy}>{t('updateLastChecked', {
      time: new Date(result.checkedAt).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US'),
    })}</Text> : null}
    {result?.error ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{t(result.error === 'rateLimit' ? 'updateRateLimit' : 'updateOffline')}</Text> : null}
    {result?.release ? <View style={styles.release}>
      <Text selectable accessibilityRole="header" style={styles.title}>{result.release.title || t('updateAvailable')}</Text>
      <Text selectable style={styles.version}>{result.release.version} · {Math.ceil(result.release.size / 1_000_000)} MB</Text>
      <Text selectable style={styles.copy}>{result.release.notes || t('updateNotesFallback')}</Text>
      <Text selectable style={styles.copy}>{t('updateDataKept')}</Text>
      <PrimaryButton disabled={downloading || updates.checking || install.status === 'installing'} label={t(staged ? 'updateContinue' : 'updateDownloadInstall')}
        onPress={() => { if (staged) updates.continue(); else void updates.download(); }} />
    </View> : null}
    {downloading ? <View>
      <Text accessibilityLiveRegion="polite" style={styles.copy}>{t('updateDownloading', { percent: Math.floor(install.progress * 100) })}</Text>
      <Pressable accessibilityRole="button" onPress={updates.cancel} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Text style={styles.actionLabel}>{t('cancel')}</Text></Pressable>
    </View> : null}
    {staged ? <Text style={styles.copy}>{t(install.status === 'ready' ? 'updateReady' : 'updateInstalling')}</Text> : null}
    {updates.notice || install.error ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{install.error ? updates.errorMessage(install.error) : updates.notice}</Text> : null}
    {!updates.supported ? <Text style={styles.copy}>{t('updateUnsupported')}</Text> :
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: updates.checking || downloading }} disabled={updates.checking || downloading} onPress={() => void updates.check()}
        style={({ pressed }) => [styles.action, pressed && styles.pressed, (updates.checking || downloading) && styles.disabled]}>
        <Text style={styles.actionLabel}>{t(updates.checking ? 'updateChecking' : 'updateCheck')}</Text>
      </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.lg },
  release: { gap: space.md, paddingTop: space.md },
  title: { color: color.ink, fontFamily: type.ticketBold, fontSize: 25, lineHeight: 31 },
  version: { color: color.ink, fontSize: 15, lineHeight: 21 },
  copy: { color: color.muted, fontSize: 15, lineHeight: 21 },
  action: { minHeight: 48, justifyContent: 'center', paddingVertical: space.sm },
  pressed: { backgroundColor: color.surfacePressed },
  disabled: { opacity: 0.45 },
  actionLabel: { color: color.action, fontFamily: type.ticketBold, fontSize: 15 },
});
