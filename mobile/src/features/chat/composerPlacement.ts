/** Keeps the composer above app navigation, while avoiding a second inset above the keyboard. */
export function composerBottomSpace(keyboardVisible: boolean, navigationInset: number): number {
  return keyboardVisible ? 0 : navigationInset;
}

export {
  keyboardOccupiesWindow,
  overlayKeyboardBehavior as keyboardAvoidingBehavior,
  overlayKeyboardOffset as keyboardAvoidingOffset,
} from '../../components/adaptiveScreen.ts';
