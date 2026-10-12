import { Monitor } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import { useAgentWorkspace } from "./agent-workspace";
import { colors, IconButton } from "./ui";
import { useWorkspace } from "./workspace";

type AgentBrowser = BrowserSession & { needsYou?: { site: string; reason: string } | null };

/** Header shortcut to watch the agent's own browser live and take control of it. */
export function AgentComputerButton() {
  const { api, workspace, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const [askedForHelp, setAskedForHelp] = useState(false);
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const working = workspace.browsers.some((b) => b.status === "active");
  const needsYou =
    askedForHelp ||
    !!data?.tasks.some((task) => task.status === "waiting_input" && !!task.state.signIn);
  useEffect(() => {
    if (!available) return;
    let active = true;
    const check = () => {
      if (AppState.currentState !== "active") return;
      api
        .request<AgentBrowser>("/api/agent-browser")
        .then((session) => {
          if (active) setAskedForHelp(!!session.needsYou);
        })
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, available]);
  async function show() {
    if (!available) return open({ type: "computer" });
    if (busy) return;
    setBusy(true);
    try {
      open({ type: "browser", browser: await api.request<AgentBrowser>("/api/agent-browser") });
    } catch {
      open({ type: "computer" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <IconButton
        floating
        icon={Monitor}
        label={
          !available
            ? "Noa's computer, offline"
            : needsYou
              ? "Noa's computer, needs you to sign in"
              : working
                ? "Noa's computer, working now"
                : "Noa's computer"
        }
        onPress={() => void show()}
      />
      {(needsYou || working) && (
        <View
          pointerEvents="none"
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            position: "absolute",
            top: 7,
            right: 8,
            backgroundColor: needsYou ? colors.danger : colors.online,
          }}
        />
      )}
    </View>
  );
}
