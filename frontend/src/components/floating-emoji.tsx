// A single emoji that floats upward and fades out, used for live "like" reactions.
import { useEffect } from "react";
import { Text } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export function FloatingEmoji({
  emoji,
  offset,
  onDone,
}: {
  emoji: string;
  offset: number;
  onDone: () => void;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(
      1,
      { duration: 2600, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [
      { translateY: -progress.value * 240 },
      { translateX: Math.sin(progress.value * Math.PI * 3) * 22 },
      { scale: 0.7 + progress.value * 0.7 },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", bottom: 12, right: 16 + offset }, style]}
    >
      <Text style={{ fontSize: 30 }}>{emoji}</Text>
    </Animated.View>
  );
}
