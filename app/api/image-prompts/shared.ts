export const NAME_MAX = 120;
export const FIELD_MAX = 16_000;

const selectColumns =
  "id, name, prompt, expected_json, created_at, updated_at";

export const imagePromptSelectColumns = selectColumns;

export function parseCreateBody(body: unknown):
  | { ok: true; name: string; prompt: string; expected_json: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body." };
  }
  const o = body as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  const prompt = cleanMultiline(String(o.prompt ?? ""));
  const expected_json = cleanMultiline(String(o.expected_json ?? ""));
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > NAME_MAX) {
    return { ok: false, error: `Name must be at most ${NAME_MAX} characters.` };
  }
  if (!prompt) return { ok: false, error: "Prompt is required." };
  if (prompt.length > FIELD_MAX) {
    return { ok: false, error: `Prompt must be at most ${FIELD_MAX} characters.` };
  }
  if (!expected_json) return { ok: false, error: "Expected JSON is required." };
  if (expected_json.length > FIELD_MAX) {
    return {
      ok: false,
      error: `Expected JSON must be at most ${FIELD_MAX} characters.`,
    };
  }
  return { ok: true, name, prompt, expected_json };
}

export function parsePatchBody(body: unknown):
  | {
      ok: true;
      updates: Partial<{ name: string; prompt: string; expected_json: string }>;
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body." };
  }
  const o = body as Record<string, unknown>;
  const updates: Partial<{ name: string; prompt: string; expected_json: string }> =
    {};
  if (o.name !== undefined) {
    const name = String(o.name).trim();
    if (!name) return { ok: false, error: "Name cannot be empty." };
    if (name.length > NAME_MAX) {
      return { ok: false, error: `Name must be at most ${NAME_MAX} characters.` };
    }
    updates.name = name;
  }
  if (o.prompt !== undefined) {
    const prompt = cleanMultiline(String(o.prompt));
    if (!prompt) return { ok: false, error: "Prompt cannot be empty." };
    if (prompt.length > FIELD_MAX) {
      return { ok: false, error: `Prompt must be at most ${FIELD_MAX} characters.` };
    }
    updates.prompt = prompt;
  }
  if (o.expected_json !== undefined) {
    const expected_json = cleanMultiline(String(o.expected_json));
    if (!expected_json) {
      return { ok: false, error: "Expected JSON cannot be empty." };
    }
    if (expected_json.length > FIELD_MAX) {
      return {
        ok: false,
        error: `Expected JSON must be at most ${FIELD_MAX} characters.`,
      };
    }
    updates.expected_json = expected_json;
  }
  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "No fields to update." };
  }
  return { ok: true, updates };
}

function cleanMultiline(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}
