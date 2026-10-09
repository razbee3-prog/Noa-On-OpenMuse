import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Share, Text, View } from "react-native";
import { API_URL } from "./api";
import { signOutLocally } from "./session-store";
import { Button, Card, ErrorNotice, Field, s } from "./ui";
import { useWorkspace } from "./workspace";

interface AccountInfo {
  displayName: string;
  email: string | null;
  provider: "apple" | "access-key";
  role: "admin" | "member";
}

/** Display name, privacy policy, sign out, account deletion and (for the admin) one-time invite codes. */
export function AccountCard() {
  const { api, refresh, notify } = useWorkspace();
  const [account, setAccount] = useState<AccountInfo>();
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .request<AccountInfo>("/api/account", undefined, "GET")
      .then((value) => {
        setAccount(value);
        setName(value.displayName);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!account) return error ? <ErrorNotice error={error} /> : null;
  return (
    <Card style={{ gap: 12 }}>
      <Text style={[s.text, { fontWeight: "600" }]}>Your account</Text>
      {account.email ? <Text style={s.small}>{account.email}</Text> : null}
      <ErrorNotice error={error} />
      <Field label="Display name" value={name} onChangeText={setName} maxLength={80} />
      <Button
        busy={busy}
        disabled={!name.trim() || name.trim() === account.displayName}
        onPress={() =>
          void run(async () => {
            setAccount(
              await api.request<AccountInfo>("/api/account", { displayName: name }, "PUT"),
            );
            await refresh();
            notify("Display name saved.");
          })
        }
      >
        Save name
      </Button>
      {account.role === "admin" ? (
        <View style={{ gap: 8 }}>
          <Button
            busy={busy}
            onPress={() =>
              void run(async () => {
                const created = await api.request<{ code: string }>("/api/invites", {});
                setInvite(created.code);
              })
            }
          >
            Create invite
          </Button>
          {invite ? (
            <>
              <Text selectable style={[s.text, { fontWeight: "600", letterSpacing: 1 }]}>
                {invite}
              </Text>
              <Text style={s.small}>Works once, for one new account, within 14 days.</Text>
              <Button onPress={() => void Share.share({ message: invite })}>Share invite</Button>
            </>
          ) : null}
        </View>
      ) : null}
      <Button
        onPress={() =>
          void run(async () => {
            await api.request("/api/session", undefined, "DELETE").catch(() => undefined);
            await signOutLocally();
          })
        }
      >
        Sign out
      </Button>
      <Button small onPress={() => void Linking.openURL(`${API_URL}/privacy.html`)}>
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
              "This permanently deletes your account, chats, tasks, memories, files, computer workspace and connected accounts. It can't be undone.";
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
    </Card>
  );
}
