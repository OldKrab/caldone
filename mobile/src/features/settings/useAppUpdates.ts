import { useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { Updates, type InstallState } from '../../../modules/caldone-updates';
import { useAppDialog } from '../../components/AppDialog';
import { getPreference, savePreference } from '../../data/mealRepository';
import { t } from '../../i18n';
import { createUpdateChecker, type AppRelease, type UpdateCheck } from '../../services/appUpdates';

const emptyInstall: InstallState = { status: 'idle', progress: 0, error: '', sha256: '' };

export function useAppUpdates(options: { ready: boolean; canPrompt: () => boolean; canInstall: () => boolean }) {
  const dialog = useAppDialog();
  const guards = useRef(options);
  guards.current = options;
  const [installed] = useState(() => Updates?.installed());
  const [checker] = useState(() => installed && createUpdateChecker({
    installedVersion: installed.version, abis: installed.abis, now: Date.now, fetch,
    read: async () => (await getPreference('updates.check')) ?? null, write: value => savePreference('updates.check', value),
  }));
  const [result, setResult] = useState<UpdateCheck>();
  const [checking, setChecking] = useState(false);
  const [install, setInstall] = useState(emptyInstall);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const continueInstall = useRef(false);
  const permissionRequested = useRef(false);
  const downloadGeneration = useRef(0);
  const latestRelease = useRef<AppRelease | undefined>(undefined);
  const prompted = useRef(new Set<string>());

  function refreshInstall() {
    const value = Updates?.state() ?? emptyInstall;
    setInstall(previous => previous.status === value.status && previous.progress === value.progress
      && previous.error === value.error && previous.sha256 === value.sha256 ? previous : value);
    return value;
  }
  function errorMessage(code: string) {
    if (code === 'storage') return t('updateStorage');
    if (code === 'permission') return t('updatePermissionDenied');
    if (code === 'cancelled') return t('updateCancelled');
    if (code === 'interrupted') return t('updateInterrupted');
    if (['integrity', 'signature', 'package', 'version', 'incompatible', 'source'].includes(code)) return t('updateRejected');
    return t('updateFailed');
  }
  function inform(message: string) {
    setNotice(message);
    if (!dialog.current() && guards.current.canInstall()) {
      dialog.show({ title: t('appUpdates'), message, actions: [{ label: t('close'), role: 'cancel' }] });
    }
  }
  async function check(manual = false) {
    if (!checker || !installed?.supported) { if (manual) inform(t('updateUnsupported')); return; }
    setChecking(true);
    setNotice('');
    try {
      const value = await checker.check(manual);
      setResult(value);
      latestRelease.current = value.release;
      if (manual) {
        if (value.error) inform(t(value.error === 'rateLimit' ? 'updateRateLimit' : 'updateOffline'));
        else if (value.release) showRelease(value.release);
        else inform(t('updateCurrent'));
      }
    } catch { if (manual) inform(t('updateOffline')); }
    finally { setChecking(false); }
  }

  async function advance() {
    if (!Updates || inFlight.current || !continueInstall.current || AppState.currentState !== 'active') return;
    const state = refreshInstall();
    if (!guards.current.canInstall() || dialog.current()) { setNotice(t('updateWaiting')); return; }
    inFlight.current = true;
    try {
      if (state.status === 'confirmation') {
        setNotice('');
        continueInstall.current = false;
        await Updates.confirm();
      } else if (state.status === 'ready') {
        if (!Updates.canInstall()) {
          continueInstall.current = false;
          if (permissionRequested.current) { inform(t('updatePermissionDenied')); return; }
          dialog.show({ title: t('updatePermissionTitle'), message: t('updatePermissionBody'), actions: [
            { label: t('updateOpenPermission'), onPress: async () => {
              permissionRequested.current = true;
              continueInstall.current = true;
              try { await Updates!.authorize(); } catch { continueInstall.current = false; inform(t('updatePermissionDenied')); }
            } },
            { label: t('cancel'), role: 'cancel' },
          ] });
        } else {
          setNotice('');
          await Updates.install();
        }
      } else if (state.status === 'error' || state.status === 'idle') {
        continueInstall.current = false;
        if (state.error) inform(errorMessage(state.error));
      }
    } catch {
      continueInstall.current = false;
      inform(errorMessage(refreshInstall().error));
    } finally { inFlight.current = false; refreshInstall(); }
  }

  async function download(release = latestRelease.current) {
    if (!Updates || !release || inFlight.current) return;
    const status = Updates.state().status;
    if (status === 'downloading' || status === 'installing') return;
    if (status === 'confirmation') { continueInstall.current = true; await advance(); return; }
    if (!guards.current.canInstall()) { inform(t('updateWaiting')); return; }
    inFlight.current = true;
    const generation = ++downloadGeneration.current;
    setNotice('');
    permissionRequested.current = false;
    try {
      // This is the sole download entry point, reached only from a user action.
      await Updates.download(release);
      continueInstall.current = generation === downloadGeneration.current;
    } catch { inform(errorMessage(refreshInstall().error)); }
    finally { inFlight.current = false; refreshInstall(); }
    await advance();
  }
  function showRelease(release = latestRelease.current) {
    if (!release || dialog.current()) return;
    if (!guards.current.canInstall()) { setNotice(t('updateWaiting')); return; }
    prompted.current.add(release.id);
    // A manually opened release also counts as seen; returning to Today must
    // not immediately repeat the same offer.
    void getPreference('updates.offered').then(async stored => {
      let seen: string[] = [];
      try { const value = JSON.parse(stored ?? '[]'); if (Array.isArray(value)) seen = value.filter(x => typeof x === 'string'); } catch { /* Disposable cache. */ }
      if (!seen.includes(release.id)) await savePreference('updates.offered', JSON.stringify([...seen.slice(-29), release.id]));
    }).catch(() => undefined);
    dialog.show({ title: release.title || t('updateAvailable'),
      message: `${t('versionLabel', { version: release.version })} · ${Math.ceil(release.size / 1_000_000)} MB\n\n${release.notes || t('updateNotesFallback')}\n\n${t('updateDataKept')}`,
      actions: [
        { label: t('updateDownloadInstall'), onPress: () => download(release) },
        { label: t('updateFullNotes'), onPress: async () => { try { await Linking.openURL(release.url); } catch { inform(t('updateOffline')); } } },
        { label: t('updateLater'), role: 'cancel' },
      ] });
  }

  useEffect(() => {
    if (!options.ready || !installed?.supported) return;
    let disposed = false;
    let checkingPrompt = false;
    const prompt = async () => {
      const release = latestRelease.current;
      if (disposed || checkingPrompt || !release || prompted.current.has(release.id)
        || !guards.current.canPrompt() || dialog.current() || inFlight.current) return;
      checkingPrompt = true;
      try {
        const stored = await getPreference('updates.offered');
        let seen: string[] = [];
        try { const parsed = JSON.parse(stored ?? '[]'); if (Array.isArray(parsed)) seen = parsed.filter(x => typeof x === 'string'); } catch { /* Old cache is disposable. */ }
        if (seen.includes(release.id)) { prompted.current.add(release.id); return; }
        if (disposed || !guards.current.canPrompt() || dialog.current()) return;
        if (!disposed && guards.current.canPrompt() && !dialog.current()) showRelease(release);
      } catch { /* Notification cache failure must not interrupt normal app use. */ }
      finally { checkingPrompt = false; }
    };
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      refreshInstall();
      void advance();
      void prompt();
    };
    const resume = () => { if (AppState.currentState === 'active') { void check(); tick(); } };
    const subscription = AppState.addEventListener('change', resume);
    // Poll only UI/installer state, never the feed. Service leases are not reactive.
    const timer = setInterval(tick, 1500);
    resume();
    return () => { disposed = true; subscription.remove(); clearInterval(timer); };
  }, [options.ready, installed, checker]);

  return { installedVersion: installed?.version ?? '—', supported: Boolean(installed?.supported),
    result, checking, install, notice, check: () => check(true), showRelease: () => showRelease(),
    continue: () => { permissionRequested.current = false; continueInstall.current = true; void advance(); },
    download: () => download(), cancel: () => { downloadGeneration.current++; continueInstall.current = false; Updates?.cancel(); setNotice(t('updateCancelled')); },
    errorMessage };
}

export type AppUpdates = ReturnType<typeof useAppUpdates>;
