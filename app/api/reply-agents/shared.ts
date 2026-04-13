import {
  buildReplyAgentSystemInstruction,
  type ReplyAgentPromptFields,
} from "@/lib/prompts";

export const NAME_MAX = 120;
export const PERSONA_TASK_MAX = 8000;
export const RULE_LINE_MAX = 2000;
export const MAX_RULES = 40;
/** Max length for optional “additional instructions” and for legacy-only `system_prompt` agents. */
export const PROMPT_EXTRA_MAX = 12000;

export function clampTemperature(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0.65;
  return Math.min(2, Math.max(0, v));
}

export function clampMaxTokens(n: unknown): number {
  const v = typeof n === "number" ? n : Math.round(Number(n));
  if (!Number.isFinite(v)) return 512;
  return Math.min(8192, Math.max(64, v));
}

export function parseRulesInput(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim().slice(0, RULE_LINE_MAX))
    .filter(Boolean)
    .slice(0, MAX_RULES);
}

export function validateAgentPayload(input: {
  name: string;
  persona: string;
  task: string;
  output_rules: string[];
  business_rules: string[];
  system_prompt: string;
}): { error?: string } {
  if (!input.name) {
    return { error: "Name is required." };
  }
  if (input.name.length > NAME_MAX) {
    return { error: `Name must be at most ${NAME_MAX} characters.` };
  }

  const legacyOnly =
    input.system_prompt.trim().length > 0 &&
    !input.persona &&
    !input.task &&
    input.output_rules.length === 0 &&
    input.business_rules.length === 0;

  if (legacyOnly) {
    if (input.system_prompt.length > PROMPT_EXTRA_MAX) {
      return { error: `System prompt must be at most ${PROMPT_EXTRA_MAX} characters.` };
    }
    return {};
  }

  if (!input.persona) {
    return { error: "Persona is required (or use only system prompt for a legacy-style agent)." };
  }
  if (input.persona.length > PERSONA_TASK_MAX) {
    return { error: `Persona must be at most ${PERSONA_TASK_MAX} characters.` };
  }
  if (!input.task) {
    return { error: "Task is required." };
  }
  if (input.task.length > PERSONA_TASK_MAX) {
    return { error: `Task must be at most ${PERSONA_TASK_MAX} characters.` };
  }
  if (input.system_prompt.length > PROMPT_EXTRA_MAX) {
    return { error: `Additional instructions must be at most ${PROMPT_EXTRA_MAX} characters.` };
  }

  const built = buildReplyAgentSystemInstruction({
    persona: input.persona,
    task: input.task,
    output_rules: input.output_rules,
    business_rules: input.business_rules,
    system_prompt: input.system_prompt || undefined,
  } satisfies ReplyAgentPromptFields);

  if (!built?.trim()) {
    return { error: "Agent instructions could not be built. Check persona and task." };
  }

  return {};
}

export const agentSelectColumns =
  "id, name, persona, task, output_rules, business_rules, system_prompt, temperature, max_output_tokens, created_at, updated_at";

/** JSON file format for export/import */
export const REPLY_AGENT_EXPORT_VERSION = 1;

export type ReplyAgentExportFile = {
  version: typeof REPLY_AGENT_EXPORT_VERSION;
  exportedAt: string;
  sourceApp: "WaChat";
  agent: {
    name: string;
    persona: string;
    task: string;
    output_rules: string[];
    business_rules: string[];
    system_prompt: string;
    temperature: number;
    max_output_tokens: number;
  };
};

/**
 * Accepts full export wrapper `{ version, agent }` or a flat agent object.
 */
export function parseReplyAgentImportPayload(
  input: unknown,
): ReplyAgentExportFile["agent"] | { error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Invalid JSON: expected an object." };
  }
  const root = input as Record<string, unknown>;
  let inner: Record<string, unknown> | null = null;
  if (
    root.agent &&
    typeof root.agent === "object" &&
    !Array.isArray(root.agent)
  ) {
    inner = root.agent as Record<string, unknown>;
  } else if (
    typeof root.name === "string" ||
    typeof root.persona === "string" ||
    typeof root.task === "string" ||
    typeof root.system_prompt === "string"
  ) {
    inner = root;
  }
  if (!inner) {
    return {
      error:
        'Invalid format: use an export file or an object with an "agent" field, or agent fields at the root.',
    };
  }

  const name = String(inner.name ?? "").trim();
  const persona = String(inner.persona ?? "").trim();
  const task = String(inner.task ?? "").trim();
  const output_rules = parseRulesInput(inner.output_rules);
  const business_rules = parseRulesInput(inner.business_rules);
  const system_prompt = String(inner.system_prompt ?? "").trim();
  const temperature = clampTemperature(inner.temperature);
  const max_output_tokens = clampMaxTokens(inner.max_output_tokens);

  const v = validateAgentPayload({
    name,
    persona,
    task,
    output_rules,
    business_rules,
    system_prompt,
  });
  if (v.error) {
    return { error: v.error };
  }

  return {
    name,
    persona,
    task,
    output_rules,
    business_rules,
    system_prompt,
    temperature,
    max_output_tokens,
  };
}

export function sanitizeAgentFilename(name: string): string {
  const s = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "reply-agent";
}

/** Row for `reply_agents` insert — matches POST /api/reply-agents legacy split. */
export function buildReplyAgentInsertRow(
  userId: string,
  fields: ReplyAgentExportFile["agent"],
) {
  const {
    name,
    persona,
    task,
    output_rules,
    business_rules,
    system_prompt,
    temperature,
    max_output_tokens,
  } = fields;
  const legacyOnly =
    system_prompt.trim().length > 0 &&
    !persona &&
    !task &&
    output_rules.length === 0 &&
    business_rules.length === 0;

  return {
    user_id: userId,
    name,
    persona: legacyOnly ? "" : persona,
    task: legacyOnly ? "" : task,
    output_rules: legacyOnly ? [] : output_rules,
    business_rules: legacyOnly ? [] : business_rules,
    system_prompt: system_prompt || null,
    temperature,
    max_output_tokens,
  };
}
