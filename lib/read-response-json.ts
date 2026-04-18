/**
 * Parse a fetch Response as JSON, or throw with a readable message when the
 * server returns HTML (e.g. login redirect) or plain-text errors.
 */
export async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 200);
    if (preview.startsWith("<")) {
      throw new Error(
        `Server returned HTML (${res.status}). Try signing in again, or refresh the page.`,
      );
    }
    throw new Error(
      preview
        ? `Server error (${res.status}): ${preview}`
        : `Empty response (${res.status})`,
    );
  }
}
