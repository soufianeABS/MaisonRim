export type ImagePrompt = {
  id: string;
  name: string;
  prompt: string;
  /**
   * Freeform JSON text describing the desired output shape.
   * This can be a JSON Schema-like object, or an example object.
   */
  expected_json: string;
  created_at: string;
  updated_at: string;
};

export const IMAGE_PROMPTS_STORAGE_KEY = "chat:imagePrompts:v1";

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadImagePromptsFromStorage(): ImagePrompt[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(IMAGE_PROMPTS_STORAGE_KEY);
  if (!raw) return [];
  const parsed = safeJsonParse<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  const out: ImagePrompt[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<ImagePrompt>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.name !== "string") continue;
    if (typeof r.prompt !== "string") continue;
    if (typeof r.expected_json !== "string") continue;
    const created_at = typeof r.created_at === "string" ? r.created_at : new Date().toISOString();
    const updated_at = typeof r.updated_at === "string" ? r.updated_at : created_at;
    out.push({
      id: r.id,
      name: r.name,
      prompt: r.prompt,
      expected_json: r.expected_json,
      created_at,
      updated_at,
    });
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function saveImagePromptsToStorage(next: ImagePrompt[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(IMAGE_PROMPTS_STORAGE_KEY, JSON.stringify(next));
}

export function newImagePromptId(): string {
  // Good enough: avoids adding a uuid dependency.
  return `ip_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

