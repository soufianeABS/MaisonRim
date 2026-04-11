/**
 * Temporary WhatsApp Cloud API outbound debug logging.
 * Set to false or delete imports after debugging.
 */
export const WHATSAPP_DEBUG_GRAPH_CALL = true;

type GraphDebugCall = {
  method?: string;
  url: string;
  headers: Record<string, string>;
  /** JSON-serializable body (logged pretty-printed). */
  jsonBody?: unknown;
  /** Non-JSON body string if needed. */
  bodyRaw?: string;
  /** When body is FormData / binary — describe fields instead of dumping bytes. */
  multipartSummary?: string;
};

/**
 * Logs a curl-like trace immediately before the matching `fetch` runs.
 * Includes full Authorization header — do not ship logs with this enabled.
 */
export function logWhatsAppGraphCall(label: string, call: GraphDebugCall): void {
  if (!WHATSAPP_DEBUG_GRAPH_CALL) return;

  const method = call.method ?? 'POST';
  const body =
    call.multipartSummary ??
    (call.jsonBody !== undefined
      ? JSON.stringify(call.jsonBody, null, 2)
      : call.bodyRaw ?? '(no body)');

  console.log('[WHATSAPP_DEBUG_GRAPH_CALL] triggered', {
    label,
    triggeredAt: new Date().toISOString(),
    method,
    url: call.url,
    headers: call.headers,
    body,
  });

  const headerLines = Object.entries(call.headers).map(
    ([k, v]) => `  -H ${JSON.stringify(`${k}: ${v}`)} \\`
  );
  const bodyForCurl =
    call.jsonBody !== undefined
      ? JSON.stringify(call.jsonBody)
      : call.bodyRaw !== undefined
        ? call.bodyRaw
        : null;

  if (bodyForCurl !== null) {
    console.log(
      `[WHATSAPP_DEBUG_GRAPH_CALL] curl (PowerShell-friendly; body is one line):\n` +
        `curl -i -X ${method} ${JSON.stringify(call.url)} \\\n` +
        `${headerLines.join('\n')}\n` +
        `  -d ${JSON.stringify(bodyForCurl)}`
    );
  } else if (call.multipartSummary) {
    console.log(
      `[WHATSAPP_DEBUG_GRAPH_CALL] curl (multipart — ${call.multipartSummary})\n` +
        `curl -i -X ${method} ${JSON.stringify(call.url)} \\\n` +
        `${headerLines.join('\n')}\n` +
        `  -F "file=@/path/to/file" -F "type=..." -F "messaging_product=whatsapp"`
    );
  }
}
