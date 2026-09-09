import { Easing, Platform } from 'react-native';

/** Semantic roles shared by every surface in the Android app. */
export const color = {
  canvas: '#F5F8F6',
  surface: '#FFFFFF',
  surfacePressed: '#E7F0EA',
  ink: '#172E26',
  muted: '#596A62',
  line: '#DCE5DF',
  rail: '#172E26',
  railMuted: '#DCE9DF',
  steel: '#82938A',
  action: '#176B4D',
  actionPressed: '#105339',
  actionSoft: '#E2F0E7',
  success: '#176B4D',
  pending: '#866019',
  attentionSoft: '#FAF1DB',
  error: '#A33D39',
  errorSoft: '#FBEAE7',
  camera: '#101B17',
  cameraChrome: 'rgba(16, 27, 23, 0.86)',
  cameraInput: '#26382E',
  cameraLine: '#647C6D',
  cameraMuted: '#CAD8CF',
  cameraText: '#FFFFFF',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 6, control: 14, surface: 18, image: 14, round: 999 } as const;
// Platform faces include Cyrillic: headings and numeric values must not silently
// fall back to a wider font when a user switches language.
export const type = {
  ticket: Platform.OS === 'android' ? 'sans-serif-medium' : 'System',
  ticketBold: Platform.OS === 'android' ? 'sans-serif-medium' : 'System',
} as const;
export const motion = {
  quick: 140,
  standard: 220,
  screen: 220,
  easeOut: Easing.out(Easing.cubic),
} as const;
