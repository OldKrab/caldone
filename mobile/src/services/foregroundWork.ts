import { AppState, Platform } from 'react-native';
import { createWorkLease } from './workLease';
import { locale } from '../i18n';

const work = createWorkLease(async () => {
  if (Platform.OS !== 'android') return;
  const { Processing } = await import('../../modules/caldone-processing');
  await Processing.start('CalDone', locale === 'ru' ? 'Анализирую еду. Можно пользоваться другими приложениями.' : 'Analyzing your meal. You can use other apps.');
}, async () => {
  if (Platform.OS !== 'android') return;
  const { Processing } = await import('../../modules/caldone-processing');
  await Processing.stop();
});
export const beginForegroundWork = async () => {
  if (AppState.currentState !== 'active' && !work.active()) return async () => {};
  return work.acquire();
};
export const foregroundWorkActive = work.active;
