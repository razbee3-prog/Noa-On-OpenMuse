import { Monitor } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import type { BrowserSession } from "../../../packages/domain/src";
import { useAgentWorkspace } from "./agent-workspace";
import { colors, IconButton } from "./ui";
import { useWorkspace } from "./workspace";

/** Header shortcut to watch the agent's own browser live and take control of it. */
export function AgentComputerButton() {
  const { api, workspace, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const [busy, setBusy] = useState(false);
  const available = workspace.connections.some(
    (c) => c.id === "browser" && c.status === "connected",
  );
  const working = workspace.browsers.some((b) => b.status === "active");
  const needsYou = !!data?.tasks.some(
    (task) => task.status === "waiting_input" && !!task.state.signIn,
  );
  if (!available) return null;
  async function show() {
    if (busy) return;
    setBusy(true);
    try {
      open({ type: "browser", browser: await api.request<BrowserSession>("/api/agent-browser") });
    } catch {
      open({ type: "computer" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <View>
      <IconButton
        icon={Monitor}
        label={
          needsYou
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
