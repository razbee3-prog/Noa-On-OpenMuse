import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Text } from "react-native";
import { API_URL } from "./api";
import { signOutLocally } from "./session-store";
import { Button, Card, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

interface AccountInfo {
  displayName: string;
  email: string | null;
  provider: "apple" | "access-key";
  role: "admin" | "member";
}

/** Signed-in identity, privacy policy, sign out, account deletion. */
export function AccountCard() {
  const { api } = useWorkspace();
  const [account, setAccount] = useState<AccountInfo>();
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .request<AccountInfo>("/api/account", undefined, "GET")
      .then(setAccount)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);
  async function run(task: () => Promise<void>) {
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  if (!account) return error ? <ErrorNotice error={error} /> : null;
  return (
    <Card style={{ gap: 12 }}>
      <Text style={[s.text, { fontWeight: "600" }]}>{account.displayName}</Text>
      {account.email ? <Text style={s.small}>{account.email}</Text> : null}
      <ErrorNotice error={error} />
      <Button
        quiet
        onPress={() =>
          void run(async () => {
            await api.request("/api/session", undefined, "DELETE").catch(() => undefined);
            await signOutLocally();
          })
        }
      >
        Sign out
      </Button>
      <Button quiet onPress={() => void Linking.openURL(`${API_URL}/privacy.html`)}>
        Privacy policy
      </Button>
      {account?.provider === "apple" && (
        <Button
          danger
          onPress={() => {
            const remove = () =>
              void run(async () => {
                await api.request("/api/account", undefined, "DELETE");
                await signOutLocally();
              });
            const message =
              "This permanently deletes your account, chats, tasks, memories, files, computer files and connected accounts. It can't be undone.";
            if (Platform.OS === "web") {
              if (globalThis.confirm?.(message)) remove();
            } else
              Alert.alert("Delete your account?", message, [
                { text: "Cancel", style: "cancel" },
                { text: "Delete account", style: "destructive", onPress: remove },
              ]);
          }}
        >
          Delete account
        </Button>
      )}
      <Text
        accessibilityRole="link"
        onPress={() =>
          void Linking.openURL("https://github.com/CopilotKit/openmuse/blob/main/LICENSE")
        }
        style={[s.small, { textAlign: "center", paddingVertical: 12 }]}
      >
        Built on OpenMuse · MIT licence
      </Text>
    </Card>
  );
}
