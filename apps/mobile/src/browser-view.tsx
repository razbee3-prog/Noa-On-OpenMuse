import { Check, Globe2, Hand, Square, X } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BrowserSession } from "../../../packages/domain/src";
import BrowserConsole from "./BrowserConsole";
import { browserSite } from "./browser-address";
import { tapHaptic } from "./haptics";
import { useWorkspace } from "./workspace";

const dark = "#111416";
const light = "#F4F6F7";
const dim = "rgba(244,246,247,0.62)";
const glass = "rgba(255,255,255,0.12)";

function Round({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: glass,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

function Pill({
  label,
  icon: Icon,
  primary,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  icon: typeof Hand;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = primary ? dark : light;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 50,
        borderRadius: 25,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: primary ? light : glass,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={color} /> : <Icon size={17} color={color} />}
      <Text style={{ color, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** Full-screen live view of a browser session. Watch Noa work; Take control to tap and type. */
export function BrowserView({
  initial,
  startInControl = false,
}: {
  initial: BrowserSession;
  startInControl?: boolean;
}) {
  const { workspace: w, api, refresh, close } = useWorkspace();
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [control, setControl] = useState(startInControl);
  const [hint, setHint] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const latest = w.browsers.find((b) => b.id === initial.id);
  const browser = {
    ...(latest && latest.updatedAt > local.updatedAt ? latest : local),
    consoleUrl: local.consoleUrl,
    previewUrl: local.previewUrl,
  };
  const live = browser.status === "active" && !!browser.consoleUrl;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api
      .request<BrowserSession>(`/api/browsers/${initial.id}`)
      .then((session) => {
        if (active) {
          setLocal(session);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [api, initial.id, retry]);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardWillShow", () => setKeyboard(true));
    const hidden = Keyboard.addListener("keyboardWillHide", () => setKeyboard(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), 1800);
    return () => clearTimeout(timer);
  }, [hint]);
  const onLocked = useCallback(() => setHint(true), []);
  async function act(path: "close" | "reopen") {
    setBusy(true);
    setError("");
    try {
      const result = await api.request<BrowserSession>(
        `/api/browsers/${browser.id}/${path}`,
        path === "reopen" ? { url: browser.url } : {},
      );
      setLocal(result);
      await refresh();
      if (path === "close") close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: dark, paddingTop: insets.top + 6 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 14,
            paddingBottom: 10,
            gap: 12,
          }}
        >
          <Round label="Close browser" onPress={close}>
            <X size={20} color={light} />
          </Round>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text numberOfLines={1} style={{ color: light, fontSize: 16, fontWeight: "600" }}>
              {browserSite(browser.url)}
            </Text>
            <Text numberOfLines={1} style={{ color: dim, fontSize: 12 }}>
              {control
                ? "You're in control"
                : browser.status === "active"
                  ? "Noa's browser"
                  : browser.status === "closed"
                    ? "Session saved"
                    : browser.status === "error"
                      ? "Needs attention"
                      : "Not open"}
            </Text>
          </View>
          {control ? (
            <Round label="Done, hand back to Noa" onPress={() => setControl(false)}>
              <Check size={20} color={light} />
            </Round>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          {loading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
              {error ? (
                <>
                  <Text style={{ color: dim, textAlign: "center", paddingHorizontal: 30 }}>
                    {error}
                  </Text>
                  <Pill label="Try again" icon={Globe2} onPress={() => setRetry(retry + 1)} />
                </>
              ) : (
                <>
                  <ActivityIndicator color={light} />
                  <Text style={{ color: dim }}>Connecting…</Text>
                </>
              )}
            </View>
          ) : live ? (
            <BrowserConsole
              fill
              url={api.url(browser.consoleUrl || "")}
              control={control}
              onLocked={onLocked}
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                paddingHorizontal: 30,
              }}
            >
              <Globe2 size={34} color={dim} />
              <Text style={{ color: light, fontSize: 17, fontWeight: "600" }}>
                {browser.status === "closed"
                  ? "This session is closed"
                  : "The view isn't available"}
              </Text>
              <Text style={{ color: dim, textAlign: "center" }}>
                Your sign-ins and downloads are saved. Reopen to pick up where you left off.
              </Text>
            </View>
          )}
          {hint && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                alignSelf: "center",
                bottom: 18,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 20,
                backgroundColor: "rgba(20,24,26,0.92)",
              }}
            >
              <Text style={{ color: light, fontSize: 14 }}>Tap Take control to interact</Text>
            </View>
          )}
        </KeyboardAvoidingView>
        {!!error && !loading && (
          <Text style={{ color: "#FFB4A8", textAlign: "center", padding: 10 }}>{error}</Text>
        )}
        {!keyboard && (
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: Math.max(insets.bottom, 12),
            }}
          >
            {control ? (
              <Text style={{ flex: 1, color: dim, textAlign: "center", paddingVertical: 6 }}>
                Tap a field to type. Tap ✓ when you're done.
              </Text>
            ) : live ? (
              <>
                <Pill
                  label="Stop task"
                  icon={Square}
                  busy={busy}
                  onPress={() => void act("close")}
                />
                <Pill label="Take control" icon={Hand} primary onPress={() => setControl(true)} />
              </>
            ) : !loading ? (
              <Pill
                label="Reopen"
                icon={Globe2}
                primary
                busy={busy}
                onPress={() => void act("reopen")}
              />
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}
