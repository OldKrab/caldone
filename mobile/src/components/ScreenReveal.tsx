import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';

import { motion } from '../design/tokens';

export function ScreenReveal(props: PropsWithChildren) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) return progress.setValue(1);
      Animated.timing(progress, {
        duration: motion.standard,
        easing: motion.easeOut,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    });
  }, [progress]);

  return (
    <Animated.View style={[
      styles.fill,
      {
        opacity: progress,
        transform: [{
          translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
        }],
      },
    ]}>
      {props.children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
