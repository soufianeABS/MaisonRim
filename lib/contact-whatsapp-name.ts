/**
 * Once `whatsapp_name` is set in `contacts`, webhook/API sync should not overwrite it
 * with different values from the provider (Green/Meta names can fluctuate).
 * Manual renames use `custom_name` via update-name; `whatsapp_name` is only filled when empty.
 */
export function resolveFrozenWhatsappName(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const cur = typeof existing === "string" ? existing.trim() : "";
  if (cur.length > 0) {
    return existing!.trim();
  }
  const inc = typeof incoming === "string" ? incoming.trim() : "";
  return inc.length > 0 ? inc : null;
}
