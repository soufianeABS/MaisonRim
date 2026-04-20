/** BCP-47 codes for Gemini translate target language (label = English name). */
export const TRANSLATION_LANGUAGES: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "ru", label: "Russian" },
  { value: "uk", label: "Ukrainian" },
  { value: "ar", label: "Arabic" },
  { value: "he", label: "Hebrew" },
  { value: "tr", label: "Turkish" },
  { value: "hi", label: "Hindi" },
  { value: "bn", label: "Bengali" },
  { value: "zh-CN", label: "Chinese (Simplified)" },
  { value: "zh-TW", label: "Chinese (Traditional)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "vi", label: "Vietnamese" },
  { value: "th", label: "Thai" },
  { value: "id", label: "Indonesian" },
  { value: "ms", label: "Malay" },
  { value: "sw", label: "Swahili" },
  { value: "am", label: "Amharic" },
];

const ALLOWED = new Set(TRANSLATION_LANGUAGES.map((l) => l.value));

export function isAllowedTranslationLanguage(code: string | null | undefined): boolean {
  if (!code || typeof code !== "string") return false;
  return ALLOWED.has(code.trim());
}
