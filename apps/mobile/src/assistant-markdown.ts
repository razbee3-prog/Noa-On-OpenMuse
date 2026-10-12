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
  const parts = text
    .split(/\n[ \t]*---[ \t]*(?:\n|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length === 1 ? chunkParagraphs(parts[0]) : parts;
}

/** Without `---`, a long reply still reads as a few texts: whole paragraphs, lists kept with their intro, at most three. */
function chunkParagraphs(text: string) {
  if (text.length <= 280 || /```|\n\s*\|/.test(text)) return [text];
  const chunks: string[] = [];
  for (const para of text.split(/\n[ \t]*\n/).map((p) => p.trim())) {
    if (!para) continue;
    const last = chunks.at(-1);
    if (last && (last.endsWith(":") || /^([-*\u2022]|\d+[.)])\s/.test(para) || last.length < 120))
      chunks[chunks.length - 1] = `${last}\n\n${para}`;
    else chunks.push(para);
  }
  while (chunks.length > 3) {
    const tail = chunks.pop();
    chunks[chunks.length - 1] += `\n\n${tail}`;
  }
  return chunks;
}
