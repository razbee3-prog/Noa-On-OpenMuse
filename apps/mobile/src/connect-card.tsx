import { Check, Globe2, Link2 } from "lucide-react-native";
import { useContext, useState } from "react";
import { Linking, Text, View } from "react-native";
import { z } from "zod";
import { JevInteractionContext } from "./jev-tool-card";
import { Button, Card, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

const connectSchema = z.object({
  kind: z.literal("connect"),
  service: z.string(),
  name: z.string(),
  reason: z.string(),
  browserAlternative: z.boolean().optional(),
});

function parse(result: unknown) {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const parsed = connectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function connectPath(service: string) {
  if (service === "google") return "/api/google/connect";
  if (service === "plaid") return "/api/plaid/connect";
  return `/api/connectors/${encodeURIComponent(service)}/connect`;
}

/** Starts the same sign-in as the Apps page, right from the chat. */
export function ConnectToolCard({ result, loading }: { result: unknown; loading: boolean }) {
  const { api, workspace: w, refresh } = useWorkspace();
  const interaction = useContext(JevInteractionContext);
  const [busy, setBusy] = useState<"" | "connect" | "done" | "browser">("");
  const [opened, setOpened] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const value = parse(result);
  if (loading || !value)
    return (
      <Card style={{ padding: 16 }}>
        <Text style={s.muted}>{loading ? "Getting Connect ready…" : "Connect unavailable."}</Text>
      </Card>
    );
  const { service, name, reason, browserAlternative } = value;
  const status = w.connections.find((c) => c.id === service)?.status;
  const connected = status === "connected" || status === "sample";
  async function act(kind: "connect" | "done" | "browser", work: () => Promise<void>) {
    setBusy(kind);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  const connect = () =>
    act("connect", async () => {
      const response = await api.request<{ url?: string | null }>(
        connectPath(service),
        service === "google" ? { capability: "read" } : {},
      );
      if (response.url) await Linking.openURL(response.url);
      setOpened(true);
      await refresh();
    });
  const reply = (kind: "done" | "browser", text: string) =>
    act(kind, async () => {
      await interaction.send(text);
      setSent(true);
    });
  return (
    <Card style={{ backgroundColor: colors.sky, gap: 10, padding: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Link2 size={18} color={colors.text} />
        <Text style={s.heading}>Connect {name}</Text>
      </View>
      <Text style={s.muted}>{reason}</Text>
      <ErrorNotice error={error} />
      <Button
        primary
        icon={connected ? Check : Link2}
        busy={busy === "connect"}
        disabled={connected || sent}
        onPress={() => void connect()}
      >
        {connected ? "Connected" : "Connect"}
      </Button>
      {(opened || connected) && (
        <Button
          icon={Check}
          busy={busy === "done"}
          disabled={sent}
          onPress={() => void reply("done", `I've connected ${name}. Please continue.`)}
        >
          {sent ? "Sent" : "I've connected, continue"}
        </Button>
      )}
      {browserAlternative && !connected && (
        <Button
          quiet
          icon={Globe2}
          busy={busy === "browser"}
          disabled={sent}
          onPress={() => void reply("browser", "Use your browser instead.")}
        >
          Use my browser instead
        </Button>
      )}
    </Card>
  );
}
