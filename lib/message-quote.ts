/** Short preview for quoted-message UI (WhatsApp-style strip). */
export function previewSnippet(text: string, maxLen = 100): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(0, maxLen - 1))}…`;
}

/** Green / WhatsApp message ids are hex; DB rows may differ only by case. */
export function messageIdVariants(id: string): string[] {
  const t = id.trim();
  if (!t) return [];
  return [...new Set([t, t.toUpperCase(), t.toLowerCase()])];
}
