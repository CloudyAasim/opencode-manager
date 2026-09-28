import type { MessageWithParts } from "@/api/types";

function hashString(s: string): number {
  let h = s.length;
  const max = Math.min(s.length, 128);
  for (let i = 0; i < max; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0; // keep 32-bit
  }
  return h;
}

export function getMessagesContentVersion(messages?: MessageWithParts[]): number {
  if (!messages) return 0;
  return messages.reduce((sum, message) => {
    return sum + message.parts.reduce((partSum, part) => {
      if ("text" in part && typeof part.text === "string") {
        return partSum + hashString(part.text);
      }
      if (part.type === "tool") {
        const state = part.state as Record<string, unknown>;
        let v = 0;
        if (typeof state.status === "string") v += hashString(state.status);
        if (typeof state.output === "string") v += hashString(state.output);
        if (typeof state.error === "string") v += hashString(state.error);
        if (typeof state.raw === "string") v += hashString(state.raw);
        return partSum + v;
      }
      return partSum + 1;
    }, 0);
  }, messages.length);
}
