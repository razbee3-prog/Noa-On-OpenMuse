import { ArrowUpRight, Check, ChevronRight, type LucideIcon, X } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tapHaptic } from "./haptics";
export const colors = {
  canvas: "#FCFCFC",
  card: "#FFFFFF",
  text: "#11191C",
  muted: "#697176",
  line: "#EEEEF0",
  blue: "#C8E7FF",
  blueDark: "#1473C8",
  sky: "#EDF7FD",
  green: "#E3F3E8",
  lavender: "#F0EEFA",
  orange: "#FDF0DF",
  danger: "#AA4A45",
  dangerSoft: "#FBEFED",
  neutral: "#F1F2F3",
  scrim: "rgba(11,18,21,0.32)",
  scrimSoft: "rgba(35,48,44,0.25)",
  handle: "#D8DBDE",
  mascotSky: "#ECF5FA",
  mascotSand: "#FAF0DF",
  mascotLilac: "#F1ECF9",
  mascotMint: "#E3F5EA",
  mascotRose: "#FBE7EC",
  mascotPeach: "#FDEBDD",
  progress: "#6AAEE0",
  financeCanvas: "#080B10",
  financeTile: "#1D2025",
  financeInk: "#D4DCFC",
  gradientStart: "#281066",
  gradientMid: "#163BBF",
  gradientEnd: "#148CE8",
  moneyPositiveOnDark: "#58D3AE",
  track: "#DFE8EB",
  trackGreen: "#24A46B",
  trackGreenSoft: "#D9F1E2",
  trackGreenText: "#17804A",
  goalBlue: "#3D9BDE",
  goalBlueSoft: "#D7E9FA",
  skySoft: "#E8F2F8",
  skyMid: "#DAEAF2",
  skyLine: "#C8DBE6",
  skyDot: "#78ABD0",
  sage: "#739174",
  sand: "#F0F0E7",
  sandLine: "#E1E2D9",
  tileSky: "#BCDAEB",
  tileSage: "#C7D6AB",
  tileLilac: "#D9CDEA",
  stone: "#EDEFEA",
  stoneLine: "#DDE3DD",
  stoneActive: "#A4BED0",
  stoneSoft: "#E3E7E3",
  focus: "#C7E4F9",
  shadow: "#18384B",
  disabledIcon: "#9CB5C5",
  online: "#57AD85",
  offline: "#ACB0B5",
  success: "#47896C",
  mailCard: "#F0EFF2",
  brandPink: "#FC2359",
  onDark: "#FFFFFF",
  onDarkMuted: "rgba(255,255,255,0.72)",
  onDarkActive: "rgba(255,255,255,0.16)",
  headerGlass: "rgba(252,252,252,0.72)",
  navGlass: "rgba(249,249,246,0.86)",
  navActive: "rgba(17,25,28,0.07)",
  glassLine: "rgba(17,25,28,0.06)",
  moneyPositive: "#1B7A43",
  moneyNegative: "#B3261E",
};
const statusWords: Record<string, string> = {
  awaiting_review: "Needs your OK",
  waiting_approval: "Needs your OK",
  waiting_input: "Needs your answer",
  queued: "Up next",
  running: "Working on it",
  executing: "Working on it",
  approved: "Approved",
  rejected: "Declined",
  completed: "Done",
  succeeded: "Done",
  failed: "Didn’t finish",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  active: "Active",
  paused: "Paused",
  closed: "Closed",
  expired: "Expired",
};
export function statusLabel(status: string) {
  const words = status.replace(/[_-]+/g, " ").trim();
  return statusWords[status] ?? words.charAt(0).toUpperCase() + words.slice(1);
}
export const s = StyleSheet.create({
  money: { fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  text: { color: colors.text, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: { color: colors.text, fontSize: 23, fontWeight: "600", letterSpacing: -0.7 },
  heading: { color: colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.25 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 23,
    borderWidth: 0,
    borderColor: colors.line,
    padding: 20,
  },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.card,
    minHeight: 45,
  },
  field: { gap: 7, marginBottom: 16 },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 17,
    minHeight: 42,
    paddingVertical: 10,
    borderRadius: 24,
  },
  primary: { backgroundColor: colors.blue },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  quiet: { backgroundColor: "transparent" },
  selected: { backgroundColor: colors.sky, borderWidth: 1, borderColor: colors.blueDark },
  buttonText: { fontSize: 14, fontWeight: "600" },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
  },
  chipText: { fontSize: 10, fontWeight: "600", color: colors.muted },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.sky,
  },
  error: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.dangerSoft,
    marginVertical: 10,
    gap: 4,
  },
  modalShade: {
    flex: 1,
    backgroundColor: colors.scrimSoft,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderRadius: 26,
    width: "100%",
    maxWidth: 790,
    maxHeight: "94%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
});
export function Button({
  children,
  onPress,
  icon: Icon,
  primary,
  disabled,
  busy,
  small,
  danger,
  selected,
  quiet,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  icon?: LucideIcon;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  selected?: boolean;
  quiet?: boolean;
  style?: ViewStyle;
}) {
  const color = danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy, selected }}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        s.button,
        primary ? s.primary : selected ? s.selected : quiet ? s.quiet : s.secondary,
        small && { minHeight: 44, paddingVertical: 7, paddingHorizontal: 13 },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} size="small" />
      ) : Icon ? (
        <Icon size={15} color={color} />
      ) : null}
      <Text style={[s.buttonText, { color: quiet && !danger ? colors.muted : color }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  floating,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  floating?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 22,
          backgroundColor: pressed ? colors.line : colors.card,
        },
        floating && {
          shadowColor: colors.shadow,
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        },
      ]}
    >
      <Icon size={20} strokeWidth={1.8} color={colors.text} />
    </Pressable>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Chip({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <View style={[s.chip, tint ? { backgroundColor: tint } : null]}>
      <Text style={s.chipText}>{children}</Text>
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={[s.small, { fontWeight: "600", color: colors.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 120, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", padding: 40, gap: 13 }}>
      <View style={[s.iconBox, { width: 55, height: 55, borderRadius: 18 }]}>
        <Icon size={24} color={colors.blueDark} />
      </View>
      <Text style={s.heading}>{title}</Text>
      <Text style={[s.muted, { textAlign: "center", maxWidth: 360 }]}>{detail}</Text>
      {children}
    </View>
  );
}
const TECHNICAL =
  /<html|<!doctype|\b(error|status) \d{3}\b|ECONN|ETIMEDOUT|TypeError|Failed to fetch|Network request failed|Unexpected token|\bat [\w.]+ \(/i;
/** Plain wording for an error; raw server text, HTML and stack traces never reach the screen. */
export function friendlyError(error: string) {
  return TECHNICAL.test(error) || error.length > 240
    ? "Something went wrong. Please try again."
    : error;
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <View accessibilityRole="alert" style={s.error}>
      <Text style={[s.text, { color: colors.danger }]}>{friendlyError(error)}</Text>
    </View>
  ) : null;
}
/** True while the on-screen keyboard is up (fires before the animation on iOS). */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
/** A left-hand drawer that slides over the current screen. */
function SideSheet({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(Math.round(width * 0.86), 380);
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [slide]);
  const close = () =>
    Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(() =>
      onClose(),
    );
  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <Animated.View style={{ flex: 1, flexDirection: "row", opacity: slide }}>
        <Animated.View
          accessibilityViewIsModal
          style={{
            width: panelWidth,
            height: "100%",
            backgroundColor: colors.canvas,
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, 12),
            borderTopRightRadius: 26,
            borderBottomRightRadius: 26,
            shadowColor: colors.text,
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 6, height: 0 },
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-panelWidth, 0],
                }),
              },
            ],
          }}
        >
          <View style={[s.between, { paddingHorizontal: 20, paddingVertical: 16 }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.title}>{title}</Text>
              {!!subtitle && <Text style={s.muted}>{subtitle}</Text>}
            </View>
            <IconButton icon={X} label="Close menu" onPress={close} />
          </View>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={close}
          style={{ flex: 1, backgroundColor: colors.scrim }}
        />
      </Animated.View>
    </Modal>
  );
}
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  wide,
  side,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  side?: boolean;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 600;
  if (side)
    return (
      <SideSheet title={title} subtitle={subtitle} onClose={onClose}>
        {children}
      </SideSheet>
    );
  return (
    <Modal transparent animationType={compact ? "slide" : "fade"} visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[s.modalShade, compact && { padding: 0, justifyContent: "flex-end" }]}
      >
        <View
          accessibilityViewIsModal
          style={[
            s.sheet,
            wide && { maxWidth: 1050 },
            compact && {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingBottom: Math.max(insets.bottom, 12),
              maxHeight: "94%",
            },
          ]}
        >
          {compact && (
            <View
              style={{
                alignSelf: "center",
                width: 34,
                height: 4,
                borderRadius: 3,
                backgroundColor: colors.handle,
                marginTop: 10,
              }}
            />
          )}
          <View
            style={[
              s.between,
              { padding: compact ? 20 : 24, borderBottomWidth: 1, borderBottomColor: colors.line },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.title}>{title}</Text>
              {!!subtitle && <Text style={s.muted}>{subtitle}</Text>}
            </View>
            <IconButton icon={X} label="Close details" onPress={onClose} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: compact ? 20 : 24 }}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function CheckRow({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[s.row, { gap: 10, paddingVertical: 9 }]}
    >
      <View
        style={{
          width: 19,
          height: 19,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: checked ? colors.text : colors.line,
          backgroundColor: checked ? colors.text : colors.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={13} color={colors.onDark} />}
      </View>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}
export function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[s.between, { marginBottom: 19 }]}>
      <Text style={s.heading}>{title}</Text>
      {action && onPress && (
        <Pressable accessibilityRole="button" onPress={onPress} style={[s.row, { gap: 5 }]}>
          <Text style={[s.small, { color: colors.text }]}>{action}</Text>
          <ArrowUpRight size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function LinkRow({
  title,
  detail,
  onPress,
  icon: Icon,
  tint,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  icon: LucideIcon;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { paddingVertical: 13, gap: 14, borderRadius: 10 },
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: tint || colors.sky }]}>
        <Icon size={19} color={colors.text} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.text, { fontWeight: "500" }]}>{title}</Text>
        {!!detail && <Text style={s.small}>{detail}</Text>}
      </View>
      <ChevronRight size={15} color={colors.muted} />
    </Pressable>
  );
}
/** OpenMuse's original capybara, shared by every assistant surface. */
export function Mascot({
  size = 42,
  variant = "sky",
}: {
  size?: number;
  variant?: "sky" | "sand" | "lilac" | "mint" | "rose" | "peach";
}) {
  const palette = {
    sky: colors.mascotSky,
    sand: colors.mascotSand,
    lilac: colors.mascotLilac,
    mint: colors.mascotMint,
    rose: colors.mascotRose,
    peach: colors.mascotPeach,
  }[variant];
  return (
    <View accessibilityLabel="Capybara mascot" style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          top: size * 0.15,
          left: size * 0.12,
          width: size * 0.76,
          height: size * 0.76,
          borderRadius: size,
          backgroundColor: palette,
        }}
      />
      <Image
        source={require("../assets/capybara.png")}
        resizeMode="contain"
        style={{ width: size, height: size }}
        accessible={false}
      />
    </View>
  );
}
export function dateLabel(value: string, options?: Intl.DateTimeFormatOptions) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", options || { month: "short", day: "numeric" });
}
export function timeLabel(value: string, timeZone?: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}
export { relativeDate } from "./relative-date";

export function resultSummary(value: string) {
  return /^Saved to (?:sample|local) sent mail(?: · .+)?$/.test(value)
    ? "Reply saved in your local Sent mail."
    : value;
}
