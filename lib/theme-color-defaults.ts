/**
 * Default HSL triplets (no `hsl()` wrapper) for shadcn-style CSS variables.
 * Must match app/globals.css :root / .dark.
 */
export const THEME_COLOR_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  /** “You :” preview in sidebar */
  "chat-you",
  /** WhatsApp-style sidebar / tools header */
  "chat-menu",
  "chat-menu-hover",
  "chat-menu-fg",
  /** Outgoing message bubble */
  "chat-bubble-sent",
  "chat-bubble-sent-fg",
  "chat-bubble-sent-ring",
  /** Incoming message bubble */
  "chat-bubble-received",
  "chat-bubble-received-fg",
  /** Green API tick marks on your messages */
  "chat-ticks-sent",
  "chat-ticks-read",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

export type ThemeColorMap = Partial<Record<ThemeColorKey, string>>;

export const DEFAULT_LIGHT_COLORS: ThemeColorMap = {
  background: "0 0% 100%",
  foreground: "0 0% 3.9%",
  card: "0 0% 100%",
  "card-foreground": "0 0% 3.9%",
  popover: "0 0% 100%",
  "popover-foreground": "0 0% 3.9%",
  primary: "0 0% 9%",
  "primary-foreground": "0 0% 98%",
  secondary: "0 0% 96.1%",
  "secondary-foreground": "0 0% 9%",
  muted: "0 0% 96.1%",
  "muted-foreground": "0 0% 45.1%",
  accent: "0 0% 96.1%",
  "accent-foreground": "0 0% 9%",
  destructive: "0 84.2% 60.2%",
  "destructive-foreground": "0 0% 98%",
  border: "0 0% 89.8%",
  input: "0 0% 89.8%",
  ring: "0 0% 3.9%",
  "chat-you": "160 84% 36%",
  "chat-menu": "142 71% 45%",
  "chat-menu-hover": "142 76% 36%",
  "chat-menu-fg": "0 0% 100%",
  "chat-bubble-sent": "160 84% 39%",
  "chat-bubble-sent-fg": "0 0% 100%",
  "chat-bubble-sent-ring": "160 63% 27%",
  "chat-bubble-received": "0 0% 100%",
  "chat-bubble-received-fg": "0 0% 3.9%",
  "chat-ticks-sent": "160 55% 88%",
  "chat-ticks-read": "48 96% 73%",
};

export const DEFAULT_DARK_COLORS: ThemeColorMap = {
  background: "0 0% 3.9%",
  foreground: "0 0% 98%",
  card: "0 0% 3.9%",
  "card-foreground": "0 0% 98%",
  popover: "0 0% 3.9%",
  "popover-foreground": "0 0% 98%",
  primary: "0 0% 98%",
  "primary-foreground": "0 0% 9%",
  secondary: "0 0% 14.9%",
  "secondary-foreground": "0 0% 98%",
  muted: "0 0% 14.9%",
  "muted-foreground": "0 0% 63.9%",
  accent: "0 0% 14.9%",
  "accent-foreground": "0 0% 98%",
  destructive: "0 62.8% 30.6%",
  "destructive-foreground": "0 0% 98%",
  border: "0 0% 14.9%",
  input: "0 0% 14.9%",
  ring: "0 0% 83.1%",
  "chat-you": "160 72% 45%",
  "chat-menu": "142 71% 45%",
  "chat-menu-hover": "142 76% 36%",
  "chat-menu-fg": "0 0% 100%",
  "chat-bubble-sent": "160 64% 35%",
  "chat-bubble-sent-fg": "0 0% 100%",
  "chat-bubble-sent-ring": "160 50% 22%",
  "chat-bubble-received": "0 0% 14.9%",
  "chat-bubble-received-fg": "0 0% 98%",
  "chat-ticks-sent": "160 45% 75%",
  "chat-ticks-read": "48 96% 73%",
};

export function mergeThemeColors(
  defaults: ThemeColorMap,
  custom: ThemeColorMap | null | undefined,
): ThemeColorMap {
  return { ...defaults, ...custom };
}
