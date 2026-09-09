export type AppScreen = 'home' | 'assistant' | 'assistant_provider' | 'chat_history' | 'camera' | 'describe' | 'capture_review' | 'settings' | 'providers' | 'detail';

export function backDestination(screen: AppScreen, _hasCapturePhotos: boolean): AppScreen | 'exit' {
  switch (screen) {
    case 'home': return 'exit';
    case 'assistant':
    case 'settings':
    case 'describe':
    case 'detail': return 'home';
    case 'assistant_provider': return 'assistant';
    case 'chat_history': return 'assistant';
    case 'providers': return 'settings';
    case 'camera': return 'home';
    case 'capture_review': return 'camera';
  }
}
