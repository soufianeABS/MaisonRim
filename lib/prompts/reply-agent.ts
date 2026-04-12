/**
 * Build Gemini system instructions from structured reply-agent fields.
 * Supports legacy rows that only have `system_prompt` filled.
 */

const TRANSCRIPT_AND_OUTPUT_HINT = `You will receive the last messages of a conversation. Each line is labeled either "Me (business)" for messages sent by the business, or "Customer" for messages from the customer.

Your job is to propose ONE appropriate reply the business could send next.

Output rules (always follow these unless overridden above):
- Output ONLY the reply text to send in the chat, with no surrounding quotes, no prefixes like "Reply:", and no markdown.`;

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (value !== null && typeof value === "object") {
    return [];
  }
  return [];
}

export type ReplyAgentPromptFields = {
  persona: string | null | undefined;
  task: string | null | undefined;
  output_rules: unknown;
  business_rules: unknown;
  system_prompt: string | null | undefined;
};

/**
 * Returns null if nothing usable is configured.
 */
export function buildReplyAgentSystemInstruction(agent: ReplyAgentPromptFields): string | null {
  const persona = (agent.persona ?? "").trim();
  const task = (agent.task ?? "").trim();
  const outputRules = normalizeStringArray(agent.output_rules);
  const businessRules = normalizeStringArray(agent.business_rules);
  const extra = (agent.system_prompt ?? "").trim();

  const hasStructured =
    persona.length > 0 ||
    task.length > 0 ||
    outputRules.length > 0 ||
    businessRules.length > 0;

  if (!hasStructured) {
    return extra.length > 0 ? extra : null;
  }

  const sections: string[] = [];

  if (persona) {
    sections.push(`## Persona\n${persona}`);
  }
  if (task) {
    sections.push(`## Task\n${task}`);
  }
  if (outputRules.length > 0) {
    sections.push(
      `## Output rules\n${outputRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    );
  }
  if (businessRules.length > 0) {
    sections.push(
      `## Business rules\n${businessRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    );
  }
  if (extra) {
    sections.push(`## Additional instructions\n${extra}`);
  }

  return `${sections.join("\n\n")}\n\n---\n${TRANSCRIPT_AND_OUTPUT_HINT}`;
}
