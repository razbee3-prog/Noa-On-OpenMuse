import MarkdownIt from "markdown-it";

export const assistantMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

export function isSafeAssistantUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

/** Noa separates distinct messages in one reply with a line holding only `---`. */
export function splitReply(text: string) {
  return text
    .split(/\n[ \t]*---[ \t]*(?:\n|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
}
