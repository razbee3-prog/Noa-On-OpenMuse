import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { colors } from "./ui";

const dots = ["first", "second", "third"] as const;

/** Three pulsing dots in a grey bubble while Noa is typing. */
export function TypingDots() {
  const values = useRef(dots.map(() => new Animated.Value(0.35))).current;
  useEffect(() => {
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 150),
          Animated.timing(value, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.35, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - 1 - index) * 150),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [values]);
  return (
    <View
      accessibilityLabel="Noa is typing"
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        gap: 5,
        paddingHorizontal: 17,
        paddingVertical: 16,
        borderRadius: 22,
        backgroundColor: colors.neutral,
      }}
    >
      {dots.map((dot, index) => (
        <Animated.View
          key={dot}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.muted,
            opacity: values[index],
            transform: [
              {
                translateY: values[index].interpolate({
                  inputRange: [0.35, 1],
                  outputRange: [0, -2],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}
