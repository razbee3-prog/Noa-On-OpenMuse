import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const native = Platform.OS === "ios" || Platform.OS === "android";

/** A light tick for taps on buttons and tabs. */
export function tapHaptic() {
  if (native) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A soft bump as each of Noa's bubbles lands. */
export function replyHaptic() {
  if (native) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}
