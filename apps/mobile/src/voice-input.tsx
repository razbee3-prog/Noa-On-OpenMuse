import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { Mic, MicOff } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable } from "react-native";
import { colors } from "./ui";
import { useWorkspace } from "./workspace";

/** Tap to talk: what the person says is written into the message box; nothing is sent automatically. */
export function VoiceInputButton({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const { notify } = useWorkspace();
  const [listening, setListening] = useState(false);
  const base = useRef("");
  useSpeechRecognitionEvent("start", () => setListening(true));
  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("result", (event) => {
    const spoken = event.results[0]?.transcript?.trim();
    if (spoken) onChange(base.current ? `${base.current} ${spoken}` : spoken);
  });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    if (event.error === "aborted" || event.error === "no-speech") return;
    notify(
      event.error === "not-allowed"
        ? "Noa can't hear you. Allow the microphone and speech recognition for Noa in Settings, then try again."
        : "Voice input stopped. Try again, or type your message.",
    );
  });
  async function toggle() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        notify(
          "Noa can't hear you. Allow the microphone and speech recognition for Noa in Settings, then try again.",
        );
        return;
      }
      base.current = value.trim();
      ExpoSpeechRecognitionModule.start({ lang: "en-US", interimResults: true, continuous: true });
    } catch {
      notify("Voice input isn't available on this device. Type your message instead.");
    }
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? "Stop listening" : "Speak your message"}
      accessibilityState={{ selected: listening, disabled }}
      disabled={disabled}
      onPress={() => void toggle()}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 24,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: listening ? colors.sky : pressed ? colors.neutral : "transparent",
      })}
    >
      {listening ? (
        <MicOff size={21} strokeWidth={1.8} color={colors.blueDark} />
      ) : (
        <Mic size={21} strokeWidth={1.8} color={disabled ? colors.disabledIcon : colors.text} />
      )}
    </Pressable>
  );
}
