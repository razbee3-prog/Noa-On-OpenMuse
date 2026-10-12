import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import * as AppleAuthentication from "expo-apple-authentication";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import { AgentComputerButton } from "./src/agent-computer-button";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import {
  API_URL,
  createAppleSession,
  createSession,
  MuseApi,
  type Session,
  sessionStillValid,
} from "./src/api";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ChromeContext } from "./src/chrome";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { Details } from "./src/details";
import { tapHaptic } from "./src/haptics";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { onSignedOut } from "./src/session-events";
import { clearSession, loadSession, saveSession } from "./src/session-store";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import {
  Button,
  Card,
  colors,
  ErrorNotice,
  Field,
  IconButton,
  Mascot,
  s,
  useKeyboardVisible,
} from "./src/ui";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "activity", label: "Activity", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: SquareCheck },
  { id: "apps", label: "Apps", icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "Activity", subtitle: "Plans, progress, decisions and results." },
  ideas: { title: "Ideas", subtitle: "Useful next steps, grounded in your world." },
  goals: {
    title: "Goals",
    subtitle: "Longer-term goals and things to keep an eye on.",
  },
  apps: {
    title: "Apps",
    subtitle: "Connections, capabilities and what your agent remembers.",
  },
  connections: { title: "Apps", subtitle: "Connections and capabilities." },
  mail: { title: "Mail", subtitle: "The conversations behind your work." },
  calendar: { title: "Calendar", subtitle: "Time for what matters." },
  browser: { title: "Browser", subtitle: "Your connected browsing sessions." },
  files: { title: "Files", subtitle: "Documents, forms and filled copies." },
};
export default function App() {
  const [token, setToken] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  // The iPhone app signs in only with Apple; the web app keeps the admin access key.
  const appleOnly = Platform.OS === "ios";
  const finish = useCallback(async (session: Session) => {
    await saveSession(session);
    setToken(session.token);
  }, []);
  const connect = useCallback(
    async (key?: string) => {
      setBusy(true);
      setError("");
      try {
        await finish(await createSession(key));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [finish],
  );
  const signInWithApple = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error("Apple did not return a sign-in token.");
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(" ");
      await finish(
        await createAppleSession({
          identityToken: credential.identityToken,
          fullName: fullName || undefined,
        }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [finish]);
  useEffect(() => onSignedOut(() => setToken("")), []);
  useEffect(() => {
    void (async () => {
      const saved = await loadSession();
      if (saved && (await sessionStillValid(saved.token))) {
        setToken(saved.token);
        setBusy(false);
        return;
      }
      await clearSession();
      if (appleOnly) setBusy(false);
      else await connect();
    })();
  }, [appleOnly, connect]);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {token ? (
        <CopilotKitProvider
          runtimeUrl={`${API_URL}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${token}` }}
        >
          <WorkspaceApp token={token} />
        </CopilotKitProvider>
      ) : (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 420, gap: 22, alignItems: "center" }}>
            <Mascot size={72} />
            <Text
              style={{ fontSize: 32, color: colors.text, letterSpacing: -1, fontWeight: "500" }}
            >
              Welcome to Noa.
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>A little room for your day.</Text>
            {busy ? (
              <ActivityIndicator color={colors.blueDark} />
            ) : (
              <Card style={{ width: "100%" }}>
                <ErrorNotice error={error} />
                {appleOnly ? (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={14}
                    style={{ width: "100%", height: 50 }}
                    onPress={() => void signInWithApple()}
                  />
                ) : (
                  <>
                    <Field
                      label="Access key"
                      value={accessKey}
                      onChangeText={setAccessKey}
                      secureTextEntry
                      placeholder="Required to sign in on the web"
                    />
                    <Button primary onPress={() => void connect(accessKey || undefined)}>
                      Open Noa
                    </Button>
                    <Text style={[s.small, { marginTop: 15 }]}>
                      Local accounts open without a key. If Noa doesn’t open, check that the app can
                      reach
                      {API_URL} and try again.
                    </Text>
                  </>
                )}
              </Card>
            )}
          </View>
        </SafeAreaView>
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({ token }: { token: string }) {
  const api = useMemo(() => new MuseApi(token), [token]);
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch((e) => setError(String(e)));
    });
    return () => listener.remove();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Opening Noa…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{ workspace, api, section, navigate, refresh, open, close, notify: setToast, ask }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={token}>
          <ThreadsProvider>
            <WorkspaceShell
              detail={detail}
              toast={toast}
              clearToast={() => setToast("")}
              error={error}
              prompt={prompt}
            />
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const keyboardVisible = useKeyboardVisible();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [headerHeight, setHeaderHeight] = useState(insets.top + 96);
  const [navHeight, setNavHeight] = useState(72);
  const navHidden = keyboardVisible && !desktop;
  const chrome = useMemo(
    () => ({ top: headerHeight, bottom: navHidden ? 0 : navHeight }),
    [headerHeight, navHeight, navHidden],
  );
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const savedName = data?.identity.name;
  const agentName = !savedName || savedName === "Noa on OpenMuse" ? "Noa" : savedName;
  const status = activeTask
    ? activeTask.status === "waiting_approval"
      ? `Ready to review · ${activeTask.title}`
      : activeTask.status === "waiting_input"
        ? `Needs your input · ${activeTask.title}`
        : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
    : data?.tasks.some((task) => task.status === "queued")
      ? "Picking up your next task…"
      : richThreads && !threadsLoading && selection.id !== mainId
        ? "Side chat"
        : "";
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files"].includes(section);
  return (
    <>
      <WorkspaceTools />
      <ChromeContext.Provider value={chrome}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["left", "right"]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}
          >
            <View style={{ flex: 1, minHeight: 0 }}>
              {section !== "chat" && (
                <ScrollView
                  key={section}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: desktop ? 42 : 22,
                    paddingTop: chrome.top + 8,
                    paddingBottom: chrome.bottom + 28,
                  }}
                  keyboardShouldPersistTaps="handled"
                >
                  {utility && (
                    <Button
                      small
                      style={{ alignSelf: "flex-start", marginBottom: 18 }}
                      onPress={() => navigate("apps")}
                    >
                      Back to Apps
                    </Button>
                  )}
                  <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                  <ErrorNotice error={error} />
                  <Screen />
                </ScrollView>
              )}
              <View
                style={{
                  display: section === "chat" ? "flex" : "none",
                  flex: 1,
                  paddingHorizontal: desktop ? 42 : 17,
                }}
              >
                {richThreads ? (
                  visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))
                ) : (
                  <ChatScreen prompt={prompt} active={section === "chat"} />
                )}
              </View>
            </View>
            <View
              onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
              style={{ position: "absolute", top: 0, left: 0, right: 0 }}
            >
              <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFillObject} />
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.headerGlass }]}
              />
              <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 8 }}>
                <View
                  style={{
                    minHeight: 84,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <IconButton
                    floating
                    icon={Menu}
                    label="Open conversations and menu"
                    onPress={() => setThreadsOpen(true)}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <AgentComputerButton />
                    <View>
                      <IconButton
                        floating
                        icon={Bell}
                        label={`Notifications, ${pending} unread or pending`}
                        onPress={() => open({ type: "notifications" })}
                      />
                      {pending > 0 && (
                        <View
                          pointerEvents="none"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 4,
                            position: "absolute",
                            top: 7,
                            right: 9,
                            backgroundColor: colors.blueDark,
                          }}
                        />
                      )}
                    </View>
                  </View>
                </View>
                <View
                  pointerEvents="box-none"
                  style={{
                    position: "absolute",
                    top: insets.top + 2,
                    left: 0,
                    right: 0,
                    alignItems: "center",
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${agentName} activity and approvals`}
                    onPress={() => {
                      tapHaptic();
                      navigate("activity");
                    }}
                    style={({ pressed }) => ({
                      alignItems: "center",
                      maxWidth: 220,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Mascot size={58} variant={data?.identity.avatar} />
                    <View
                      style={{
                        marginTop: -8,
                        paddingHorizontal: 13,
                        paddingVertical: 5,
                        borderRadius: 16,
                        alignItems: "center",
                        backgroundColor: colors.card,
                        shadowColor: colors.shadow,
                        shadowOpacity: 0.1,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 2 },
                        elevation: 2,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 15,
                          fontWeight: "600",
                          color: colors.text,
                          letterSpacing: -0.2,
                        }}
                      >
                        {agentName}
                      </Text>
                      {section === "chat" && !!status && (
                        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>
                          {status}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </View>
                {section === "chat" && (
                  <>
                    <AgentStatus />
                    {richThreads && <ErrorNotice error={threadsError} />}
                    {richThreads && threadsError ? (
                      <Button onPress={retryThreads}>Retry main chat</Button>
                    ) : richThreads && threadsLoading ? (
                      <ActivityIndicator color={colors.blueDark} />
                    ) : null}
                  </>
                )}
              </View>
            </View>
            {!navHidden && (
              <View
                onLayout={(event) => setNavHeight(event.nativeEvent.layout.height)}
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  paddingHorizontal: 10,
                  paddingBottom: desktop ? 22 : Math.max(insets.bottom - 10, 8),
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: "100%",
                    borderRadius: 34,
                    shadowColor: colors.shadow,
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: 0.12,
                    shadowRadius: 22,
                    elevation: 6,
                  }}
                >
                  <View style={{ borderRadius: 34, overflow: "hidden" }}>
                    <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject} />
                    <View
                      style={{
                        flexDirection: "row",
                        padding: 6,
                        borderRadius: 34,
                        borderWidth: 1,
                        borderColor: colors.glassLine,
                        backgroundColor: colors.navGlass,
                      }}
                    >
                      {nav.map((item) => {
                        const active = section === item.id || (item.id === "apps" && utility);
                        return (
                          <Pressable
                            key={item.id}
                            accessibilityRole="tab"
                            accessibilityLabel={item.label}
                            accessibilityState={{ selected: active }}
                            onPress={() => {
                              tapHaptic();
                              navigate(item.id);
                            }}
                            style={{
                              flex: 1,
                              minHeight: 54,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: active ? colors.navActive : "transparent",
                              borderRadius: 28,
                            }}
                          >
                            <item.icon
                              size={24}
                              strokeWidth={active ? 2 : 1.7}
                              color={active ? colors.text : colors.muted}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>
            )}
          </KeyboardAvoidingView>
          {!!toast && (
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                bottom: chrome.bottom + 14,
                left: 20,
                right: 20,
                alignItems: "center",
              }}
            >
              <View
                style={[
                  s.row,
                  {
                    gap: 10,
                    padding: 14,
                    backgroundColor: colors.text,
                    borderRadius: 20,
                    maxWidth: 560,
                  },
                ]}
              >
                <Check size={16} color={colors.blue} />
                <Text style={{ color: colors.onDark, fontSize: 13, flexShrink: 1 }}>{toast}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss notification"
                  onPress={clearToast}
                >
                  <X size={16} color={colors.onDark} />
                </Pressable>
              </View>
            </View>
          )}
          {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
          {detail && (
            <Details
              key={
                detail.type === "task"
                  ? detail.taskId
                  : detail.type === "file"
                    ? detail.file.id
                    : detail.type === "browser"
                      ? detail.browser.id
                      : detail.type === "mail"
                        ? detail.mail.id
                        : detail.type === "review"
                          ? detail.action.id
                          : detail.type === "email"
                            ? JSON.stringify(detail.draft)
                            : detail.type === "event"
                              ? detail.event?.id || "event-new"
                              : detail.type
              }
              detail={detail}
            />
          )}
        </SafeAreaView>
      </ChromeContext.Provider>
    </>
  );
}
