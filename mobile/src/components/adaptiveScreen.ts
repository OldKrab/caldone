export type KeyboardSafeAreaConfig = {
  behavior: 'padding' | undefined;
  edges: readonly ['top', 'right', 'bottom', 'left'];
  keyboardVerticalOffset: number;
};

/**
 * A screen that owns the bottom safe area must avoid the IME with padding.
 * Keeping the safe-area padding in the same layout prevents Android edge-to-edge
 * keyboards from alternately clipping and double-offsetting focused controls.
 */
export function keyboardSafeAreaConfig(platform: string): KeyboardSafeAreaConfig {
  return {
    behavior: platform === 'android' || platform === 'ios' ? 'padding' : undefined,
    edges: ['top', 'right', 'bottom', 'left'],
    keyboardVerticalOffset: 0,
  };
}

/** Two-column form rows stop being useful once text scaling makes either field cramped. */
export function shouldStackFormFields(width: number, fontScale: number): boolean {
  return width < 360 || fontScale >= 1.2;
}

/** Android may resize the JS window without dispatching keyboardDidShow. */
export function keyboardOccupiesWindow(eventVisible: boolean, windowHeight: number, restingHeight: number): boolean {
  return eventVisible || restingHeight - windowHeight > 120;
}

/** Overlay-root screens must avoid keyboards that cover the edge-to-edge window. */
export function overlayKeyboardBehavior(platform: string): 'padding' | undefined {
  return platform === 'android' || platform === 'ios' ? 'padding' : undefined;
}

/** The IME reports screen coordinates, while the avoiding view's frame starts
 * below its parent's top safe-area padding. Bottom navigation is unrelated to
 * that origin and differs between gesture and three-button navigation.
 */
export function overlayKeyboardOffset(platform: string, safeAreaTop: number): number {
  return platform === 'android' ? safeAreaTop : 0;
}
