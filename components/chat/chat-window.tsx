"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Send, MessageCircle, Loader2, X, Download, FileText, Image as ImageIcon, Play, Pause, RefreshCw, Volume2, Paperclip, MessageSquare, Users, Sparkles, FlaskConical, Trash2, Reply, Smile, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchContactStatusesCached } from "@/lib/contact-statuses-cache";
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MediaUpload } from "./media-upload";
import { ImageViewerDialog } from "./image-viewer-dialog";
import { UserInfoDialog } from "./user-info-dialog";
import { TemplateSelector } from "./template-selector";
import { SavedMessagePicker } from "./saved-message-picker";
import {
  ContactDataPopover,
  ContactDataTriggerButton,
} from "./contact-data-popover";

// Template interfaces
interface TemplateComponent {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{
    type: string;
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  components: TemplateComponent[];
}

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
  avatar_url?: string | null;
  last_active: string;
  status_id?: string | null;
  status_name?: string | null;
  status_color?: string | null;
  status_rule?: string | null;
  /** From contact_conversations.status_rule_mode — enables Suggest reply without messages when "hard". */
  status_rule_mode?: "ai" | "hard" | null;
}

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  timestamp: string;
  is_sent_by_me: boolean;
  message_type?: string;
  media_data?: string | null;
  is_read?: boolean;
  read_at?: string | null;
  isOptimistic?: boolean; // Flag for optimistic messages
}

function parseQuotedRefFromMedia(message: Message): {
  id: string | null;
  preview?: string;
} {
  const raw = message.media_data;
  if (raw == null) {
    return { id: null };
  }
  let p: Record<string, unknown>;
  try {
    if (typeof raw === "string") {
      p = JSON.parse(raw) as Record<string, unknown>;
    } else if (typeof raw === "object") {
      p = raw as Record<string, unknown>;
    } else {
      return { id: null };
    }
  } catch {
    return { id: null };
  }
  const id =
    typeof p.quoted_message_id === "string" ? p.quoted_message_id : null;
  const preview =
    typeof p.quoted_message_preview === "string"
      ? p.quoted_message_preview
      : undefined;
  return id ? { id, preview } : { id: null };
}

function snippetForQuotedMessage(m: Message): string {
  const t = m.message_type || "text";
  switch (t) {
    case "image":
      return m.content?.match(/^\[/) ? m.content : "Photo";
    case "video":
      return "Video";
    case "audio":
      return m.content?.includes("Voice") ? "Voice message" : "Audio";
    case "document":
      return m.content?.startsWith("[Document") ? m.content : "Document";
    case "template":
      return "Template";
    default:
      return (m.content || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }
}

interface MediaData {
  type: string;
  id?: string;
  mime_type?: string;
  sha256?: string;
  filename?: string;
  caption?: string;
  voice?: boolean;
  media_url?: string;
  s3_uploaded?: boolean;
  upload_timestamp?: string;
  url_refreshed_at?: string;
  template_name?: string; // Added for template messages
  language?: string; // Added for template language
  header?: {
    format: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
    media_url?: string;
    text?: string;
    filename?: string; // Added for document headers
  };
  body?: {
    text?: string;
  };
  footer?: {
    text?: string;
  };
  buttons?: Array<{
    type: 'URL' | 'PHONE_NUMBER' | 'QUICK_REPLY';
    text: string;
    url?: string;
    phone_number?: string;
  }>;
}

interface MediaFile {
  id: string;
  file: File;
  type: 'image' | 'document' | 'audio' | 'video';
  preview?: string;
  caption?: string;
}

interface ChatWindowProps {
  selectedUser: ChatUser | null;
  messages: Message[];
  /** Optional reply — `quotedMessageId` is the WhatsApp / Green message id to quote. */
  onSendMessage: (
    content: string,
    options?: { quotedMessageId?: string },
  ) => void;
  /** When set, show Reply / React on messages (1:1 only; hidden for broadcast). */
  messagingProvider?: "whatsapp_cloud" | "green_api" | null;
  /** Send emoji reaction to an existing message (provider-specific API). */
  onSendReaction?: (messageId: string, emoji: string) => Promise<void>;
  onBack?: () => void;
  onClose?: () => void;
  isMobile?: boolean;
  isLoading?: boolean;
  /** True while the 1:1 thread is loading from the server (no cached prefetch). */
  isMessagesLoading?: boolean;
  onUpdateName?: (userId: string, customName: string) => Promise<void>;
  onUsersUpdate?: () => void;
  broadcastGroupName?: string | null;
  /** Called after a message row is removed (e.g. localhost test delete) so parent state updates even if Realtime lags */
  onMessageDeleted?: (messageId: string) => void;
}

/** Green API outgoingMessageStatus → WhatsApp-style ticks on your bubbles */
function GreenOutgoingTicks({ status }: { status: string | null }) {
  const isRead = status === "read";
  const isDelivered = status === "delivered" || isRead;
  const isFailed = status === "failed";
  /** Read = bright yellow ticks + dark rim + soft yellow glow on emerald-600 bubbles */
  const tickClass = isRead
    ? "text-yellow-200 [filter:drop-shadow(0_0.5px_0_rgba(6,78,59,0.95))_drop-shadow(0_1.5px_2px_rgba(0,0,0,0.4))_drop-shadow(0_0_10px_rgba(250,204,21,0.75))]"
    : "text-emerald-100/90";
  const readStroke = isRead ? 3 : 2.5;

  if (isFailed) {
    return (
      <span
        className="text-[10px] font-semibold text-amber-200"
        title="Not delivered"
        aria-label="Not delivered"
      >
        !
      </span>
    );
  }

  const label = isRead ? "Read" : isDelivered ? "Delivered" : "Sent";

  if (isDelivered || isRead) {
    return (
      <span
        className={`inline-flex items-center ${tickClass}`}
        title={label}
        aria-label={label}
      >
        <Check className="h-3.5 w-3.5 -mr-2" strokeWidth={readStroke} />
        <Check className="h-3.5 w-3.5" strokeWidth={readStroke} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center ${tickClass}`}
      title={label}
      aria-label={label}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={readStroke} />
    </span>
  );
}

const QUICK_REACTION_EMOJIS = ["👍", "😊", "❤️", "😂", "😮", "😢", "🙏"];

/** Green API has no documented send for WhatsApp bubble reactions — API uses quoted emoji reply only. */
function quickReactionButtonTitle(
  provider: ChatWindowProps["messagingProvider"],
  emoji: string,
): string {
  if (provider === "green_api") {
    return `Reply with ${emoji} (quoted message; Green API cannot attach sticker-style reactions)`;
  }
  return `React with ${emoji}`;
}

const COMPOSER_EMOJI_USAGE_KEY = "wachat:composerEmojiUsage";

const COMPOSER_EMOJI_PALETTE = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🙏",
  "😊",
  "🔥",
  "✨",
  "👏",
  "🎉",
  "💯",
  "🙌",
  "🤔",
  "😅",
  "🤣",
  "😍",
  "🥰",
  "😘",
  "😎",
  "🫶",
  "🩷",
  "✅",
  "❌",
  "⭐",
  "💪",
  "👀",
  "🤝",
  "👋",
  "😭",
  "🥳",
  "🤯",
  "😴",
  "🙈",
  "💔",
  "🤷",
  "🫡",
  "☕",
  "🚀",
  "💬",
  "📎",
  "😬",
  "😐",
  "🥲",
  "😀",
  "🤩",
  "👻",
  "🎈",
] as const;

function sortComposerEmojisByUsage(
  defaults: readonly string[],
  usage: Record<string, number>,
): string[] {
  const all = new Set<string>([...defaults, ...Object.keys(usage)]);
  return [...all].sort((a, b) => {
    const ua = usage[a] ?? 0;
    const ub = usage[b] ?? 0;
    if (ub !== ua) return ub - ua;
    const ia = defaults.indexOf(a);
    const ib = defaults.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function ChatWindow({ 
  selectedUser, 
  messages, 
  onSendMessage, 
  messagingProvider = null,
  onSendReaction,
  onBack, 
  onClose,
  isMobile = false,
  isLoading = false,
  isMessagesLoading = false,
  onUpdateName,
  onUsersUpdate,
  broadcastGroupName,
  onMessageDeleted,
}: ChatWindowProps) {
  const [messageInput, setMessageInput] = useState("");
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const [refreshingUrls, setRefreshingUrls] = useState<Set<string>>(new Set());
  const refreshingUrlsRef = useRef<Set<string>>(new Set());
  const refreshedOnceRef = useRef<Set<string>>(new Set());
  const lastRefreshAtRef = useRef<Record<string, number>>({});
  const [loadingMedia, setLoadingMedia] = useState<Set<string>>(new Set());
  const [mediaUrlOverrides, setMediaUrlOverrides] = useState<Record<string, string>>({});
  const [runningAction, setRunningAction] = useState(false);
  const [mappedStatusIds, setMappedStatusIds] = useState<Set<string>>(new Set());
  const [audioDurations, setAudioDurations] = useState<{ [key: string]: number }>({});
  const [audioCurrentTime, setAudioCurrentTime] = useState<{ [key: string]: number }>({});
  const [showMediaUpload, setShowMediaUpload] = useState(false);
  const [mediaUploadInitialFiles, setMediaUploadInitialFiles] = useState<File[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showSavedMessagePicker, setShowSavedMessagePicker] = useState(false);
  const [contactDataOpen, setContactDataOpen] = useState(false);
  const [replyAgents, setReplyAgents] = useState<{ id: string; name: string }[]>([]);
  const [replyAgentsLoading, setReplyAgentsLoading] = useState(false);
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [isLocalhostDev, setIsLocalhostDev] = useState(false);
  const [devInsertLoading, setDevInsertLoading] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  const [devComposeOpen, setDevComposeOpen] = useState(false);
  const [devComposeKind, setDevComposeKind] = useState<"in" | "out" | "both" | null>(
    null,
  );
  const [devTextInbound, setDevTextInbound] = useState("");
  const [devTextOutbound, setDevTextOutbound] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [reactionBusyId, setReactionBusyId] = useState<string | null>(null);
  /** Mobile: which message shows the quick-reaction emoji row (desktop uses hover). */
  const [reactionEmojiMenuMessageId, setReactionEmojiMenuMessageId] = useState<string | null>(null);
  const [composerEmojiPickerOpen, setComposerEmojiPickerOpen] = useState(false);
  const [imageViewer, setImageViewer] = useState<{
    url: string;
    filename: string;
    messageId: string;
  } | null>(null);
  const [composerEmojiUsage, setComposerEmojiUsage] = useState<Record<string, number>>({});
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  /** Wraps the message list; height grows when images load — observe for scroll correction. */
  const messagesInnerRef = useRef<HTMLDivElement>(null);
  /** If true, keep pinned to bottom when content height changes (images, late layout). */
  const stickToBottomRef = useRef(true);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const composerEmojiWrapRef = useRef<HTMLDivElement>(null);
  const contactDataWrapRef = useRef<HTMLDivElement>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});

  const sortedComposerEmojis = useMemo(
    () => sortComposerEmojisByUsage(COMPOSER_EMOJI_PALETTE, composerEmojiUsage),
    [composerEmojiUsage],
  );

  /** When contact_conversations has no status_rule_mode column yet, resolve from /api/contact-statuses. */
  const [resolvedStatusRuleMode, setResolvedStatusRuleMode] = useState<"ai" | "hard" | null>(null);
  const [resolvedRuleText, setResolvedRuleText] = useState("");

  useEffect(() => {
    if (!selectedUser || broadcastGroupName) {
      setResolvedStatusRuleMode(null);
      setResolvedRuleText("");
      return;
    }
    const parentMode = selectedUser.status_rule_mode;
    if (parentMode === "hard" || parentMode === "ai") {
      setResolvedStatusRuleMode(parentMode);
      setResolvedRuleText(selectedUser.status_rule?.trim() ?? "");
      return;
    }
    const sid = selectedUser.status_id;
    if (!sid) {
      setResolvedStatusRuleMode(null);
      setResolvedRuleText("");
      return;
    }
    setResolvedStatusRuleMode(null);
    setResolvedRuleText("");
    let cancelled = false;
    void (async () => {
      try {
        const statuses = await fetchContactStatusesCached();
        if (cancelled) return;
        const s = statuses.find((x) => x.id === sid);
        if (cancelled) return;
        if (!s) {
          setResolvedStatusRuleMode(null);
          setResolvedRuleText("");
          return;
        }
        setResolvedStatusRuleMode(s.rule_mode === "hard" ? "hard" : "ai");
        setResolvedRuleText(String(s.rule ?? "").trim());
      } catch {
        if (!cancelled) {
          setResolvedStatusRuleMode(null);
          setResolvedRuleText("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    broadcastGroupName,
    selectedUser?.id,
    selectedUser?.status_id,
    selectedUser?.status_rule_mode,
    selectedUser?.status_rule,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hostname;
    setIsLocalhostDev(
      h === "localhost" || h === "127.0.0.1" || h === "::1",
    );
  }, []);

  // Load available ApiActions (Tag -> API mappings) once, so we can disable
  // the "Run action" button when no mapping exists for the tag.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/api-actions", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const ids = new Set<string>();
        const actions = Array.isArray(data?.actions) ? (data.actions as Array<{ status_id?: unknown }>) : [];
        for (const a of actions) {
          if (typeof a?.status_id === "string" && a.status_id) ids.add(a.status_id);
        }
        if (!cancelled) setMappedStatusIds(ids);
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const insertDevTestMessages = async (
    kind: "in" | "out" | "both",
    texts?: { inbound?: string; outbound?: string },
  ) => {
    if (!selectedUser || broadcastGroupName) return;
    setDevInsertLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        alert("Not signed in.");
        return;
      }

      const ts = new Date().toISOString();
      const contactId = selectedUser.id;
      const businessId = user.id;

      const inboundContent =
        texts?.inbound?.trim() || `[dev] Inbound test — ${ts}`;
      const outboundContent =
        texts?.outbound?.trim() || `[dev] Outbound test — ${ts}`;

      await supabase.from("users").upsert(
        {
          id: businessId,
          name: user.email ?? "Dev user",
          last_active: ts,
        },
        { onConflict: "id" },
      );

      await supabase.from("users").upsert(
        {
          id: contactId,
          name: selectedUser.name,
          last_active: ts,
        },
        { onConflict: "id" },
      );

      const rows: Array<{
        id: string;
        sender_id: string;
        receiver_id: string;
        content: string;
        timestamp: string;
        is_sent_by_me: boolean;
        is_read: boolean;
        message_type: string;
        media_data: null;
      }> = [];

      const base = Date.now();
      if (kind === "in" || kind === "both") {
        rows.push({
          id: `dev_in_${base}_${Math.random().toString(36).slice(2, 9)}`,
          sender_id: contactId,
          receiver_id: businessId,
          content: inboundContent,
          timestamp: ts,
          is_sent_by_me: false,
          is_read: false,
          message_type: "text",
          media_data: null,
        });
      }
      if (kind === "out" || kind === "both") {
        rows.push({
          id: `dev_out_${base + 1}_${Math.random().toString(36).slice(2, 9)}`,
          sender_id: contactId,
          receiver_id: businessId,
          content: outboundContent,
          timestamp: ts,
          is_sent_by_me: true,
          is_read: true,
          message_type: "text",
          media_data: null,
        });
      }

      const { error } = await supabase.from("messages").insert(rows);
      if (error) {
        console.error("[dev] insert messages:", error);
        alert(`Dev insert error: ${error.message}`);
      }
    } finally {
      setDevInsertLoading(false);
    }
  };

  const openDevCompose = (kind: "in" | "out" | "both") => {
    setDevComposeKind(kind);
    setDevTextInbound("");
    setDevTextOutbound("");
    setDevComposeOpen(true);
  };

  const submitDevCompose = async () => {
    if (!devComposeKind) return;
    await insertDevTestMessages(devComposeKind, {
      inbound: devTextInbound,
      outbound: devTextOutbound,
    });
    setDevComposeOpen(false);
    setDevComposeKind(null);
  };

  const handleDeleteTestMessage = async (messageId: string) => {
    if (!isLocalhostDev) return;
    if (messageId.startsWith("optimistic_")) return;
    if (!window.confirm("Delete this message? (localhost test mode)")) return;

    setDeletingMessageId(messageId);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("id", messageId);
      if (error) {
        console.error("[dev] delete message:", error);
        alert(`Could not delete: ${error.message}`);
      } else {
        onMessageDeleted?.(messageId);
      }
    } finally {
      setDeletingMessageId(null);
    }
  };

  const handleDeleteConversation = async () => {
    if (!isLocalhostDev) return;
    if (!selectedUser || broadcastGroupName) return;
    if (
      !window.confirm(
        "Delete the whole conversation? (localhost test mode)\n\nThis will delete all messages with this contact AND remove the contact from your list.",
      )
    ) {
      return;
    }

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        alert("Not signed in.");
        return;
      }

      const contactId = selectedUser.id;
      const businessId = user.id;

      // In this app, messages are stored with sender_id=contact and receiver_id=business
      // for both directions (see dev insert + server webhook mapping).
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("sender_id", contactId)
        .eq("receiver_id", businessId);

      if (error) {
        console.error("[dev] delete conversation:", error);
        alert(`Could not delete conversation: ${error.message}`);
        return;
      }

      // Also remove the contact row so it disappears from the conversation list.
      // Never delete your own business row.
      if (contactId !== businessId) {
        const { error: userDeleteError } = await supabase
          .from("contacts")
          .delete()
          .eq("owner_id", businessId)
          .eq("phone", contactId);
        if (userDeleteError) {
          console.error("[dev] delete contact row:", userDeleteError);
          alert(
            `Messages deleted, but could not delete contact row: ${userDeleteError.message}`,
          );
        }
      }

      // Clear local UI immediately
      onMessageDeleted?.("__clear_all__");
      // Refresh list so last_message/unread updates
      await onUsersUpdate?.();

      // Close the conversation UI
      if (isMobile && onBack) {
        onBack();
      } else if (!isMobile && onClose) {
        onClose();
      }
    } catch (e) {
      console.error("[dev] delete conversation unexpected:", e);
      alert(e instanceof Error ? e.message : "Could not delete conversation.");
    }
  };

  // Handle template message sending
  const handleSendTemplate = async (templateName: string, templateData: WhatsAppTemplate, variables: {
    header: Record<string, string>;
    body: Record<string, string>;
    footer: Record<string, string>;
  }) => {
    // Handle broadcast mode
    if (broadcastGroupName) {
      // Call onSendMessage with template data - it will be routed to broadcast endpoint
      const templateMessage = `Template: ${templateName}`;
      // Store template data in a special format that the broadcast handler can use
      onSendMessage(JSON.stringify({
        type: 'template',
        templateName,
        templateData,
        variables,
        displayMessage: templateMessage
      }));
      return;
    }
    
    if (!selectedUser) return;

    try {
      const response = await fetch('/api/send-template', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: selectedUser.id,
          templateName,
          templateData,
          variables,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || 'Failed to send template');
      }

      console.log('Template sent successfully:', result);
    } catch (error) {
      console.error('Error sending template:', error);
      throw error; // Let the template selector handle the error display
    }
  };

  // Calculate unread messages
  const unreadMessages = messages.filter(msg => 
    !msg.is_sent_by_me && !msg.is_read
  );
  const firstUnreadIndex = messages.findIndex(msg => 
    !msg.is_sent_by_me && !msg.is_read
  );
  const hasUnreadMessages = unreadMessages.length > 0;

  const scrollMessagesToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const onMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    /** Pixels from bottom still considered “at bottom” for pin / auto-scroll. */
    const threshold = 48;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distFromBottom <= threshold;
  }, []);

  /** After layout/paint (e.g. image decode) — double rAF so scrollHeight matches final layout. */
  const ensurePinnedToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!stickToBottomRef.current) return;
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  // New conversation / broadcast: always start pinned to bottom.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [selectedUser?.id, broadcastGroupName]);

  useEffect(() => {
    setReplyingTo(null);
    setShowSavedMessagePicker(false);
    setShowTemplateSelector(false);
  }, [selectedUser?.id, broadcastGroupName]);

  // Snap to bottom when opening a conversation or when the list grows (instant, before paint — no scroll animation)
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    scrollMessagesToBottom();
    stickToBottomRef.current = true;
  }, [selectedUser?.id, broadcastGroupName, messages.length, scrollMessagesToBottom]);

  // Images and media load after paint — inner column grows; keep bottom aligned if user is still “at bottom”.
  useEffect(() => {
    const outer = messagesContainerRef.current;
    const inner = messagesInnerRef.current;
    if (!outer || !inner || messages.length === 0) return;

    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      requestAnimationFrame(() => {
        if (!stickToBottomRef.current) return;
        outer.scrollTop = outer.scrollHeight;
      });
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [
    selectedUser?.id,
    broadcastGroupName,
    messages.length,
    isMessagesLoading,
  ]);

  // Handle ESC key press within the chat window
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (composerEmojiPickerOpen) {
          setComposerEmojiPickerOpen(false);
        } else if (showMediaUpload) {
          setShowMediaUpload(false);
        } else if (showSavedMessagePicker) {
          setShowSavedMessagePicker(false);
        } else if (contactDataOpen) {
          setContactDataOpen(false);
        } else if (showTemplateSelector) {
          setShowTemplateSelector(false);
        } else if (isMobile && onBack) {
          onBack();
        } else if (!isMobile && onClose) {
          onClose();
        }
      }
    };

    // Only add listener when chat window is active (selectedUser exists)
    if (selectedUser || broadcastGroupName) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [
    selectedUser,
    broadcastGroupName,
    isMobile,
    onBack,
    onClose,
    showMediaUpload,
    showTemplateSelector,
    showSavedMessagePicker,
    contactDataOpen,
    composerEmojiPickerOpen,
  ]);

  useEffect(() => {
    setReactionEmojiMenuMessageId(null);
    setComposerEmojiPickerOpen(false);
    setContactDataOpen(false);
  }, [selectedUser?.id, broadcastGroupName]);

  useEffect(() => {
    if (!contactDataOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = contactDataWrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setContactDataOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [contactDataOpen]);

  // Handle drag and drop for the entire chat window
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only set dragging to false if we're leaving the chat window entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && selectedUser) {
      setShowMediaUpload(true);
      // The MediaUpload component will handle the files
    }
  }, [selectedUser]);

  const adjustMessageInputHeight = useCallback(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    adjustMessageInputHeight();
  }, [messageInput, adjustMessageInputHeight]);

  const commitSend = useCallback(() => {
    if (
      !messageInput.trim() ||
      (!selectedUser && !broadcastGroupName) ||
      isLoading ||
      sendingMedia
    ) {
      return;
    }
    onSendMessage(messageInput.trim(), replyingTo ? { quotedMessageId: replyingTo.id } : undefined);
    setReplyingTo(null);
    setMessageInput("");
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      adjustMessageInputHeight();
    });
  }, [
    messageInput,
    selectedUser,
    broadcastGroupName,
    isLoading,
    sendingMedia,
    onSendMessage,
    replyingTo,
    adjustMessageInputHeight,
  ]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    commitSend();
  };

  const replyPreviewSnippet = (m: Message) => {
    const t = (m.content ?? "").trim();
    if (!t) return "(no text)";
    return t.length > 80 ? `${t.slice(0, 77)}…` : t;
  };

  const contactDisplayName =
    selectedUser?.custom_name ||
    selectedUser?.whatsapp_name ||
    selectedUser?.name ||
    "Contact";

  const renderQuoteStripe = (message: Message, isOwn: boolean) => {
    const ref = parseQuotedRefFromMedia(message);
    const quotedId = ref.id;
    if (!quotedId) return null;
    const original = messages.find(
      (m) =>
        m.id === quotedId || m.id.toLowerCase() === quotedId.toLowerCase(),
    );
    const snippet =
      (original ? snippetForQuotedMessage(original) : null) ||
      ref.preview?.trim() ||
      "";
    const label = original
      ? original.is_sent_by_me
        ? "You"
        : contactDisplayName
      : "Message";
    const body = snippet || "—";

    return (
      <div
        className={`mb-2 rounded-lg overflow-hidden border-l-4 pl-3 py-2 pr-2 text-left ${
          isOwn
            ? "border-white/70 bg-black/15"
            : "border-emerald-600/80 bg-muted/70 dark:bg-muted/40"
        }`}
      >
        <div
          className={`text-xs font-semibold ${
            isOwn ? "text-emerald-50" : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {label}
        </div>
        <div
          className={`text-xs line-clamp-2 mt-0.5 break-words ${
            isOwn ? "text-emerald-50/95" : "text-muted-foreground"
          }`}
        >
          {body}
        </div>
      </div>
    );
  };

  const handleMessageInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    commitSend();
  };

  const clearMediaUploadInitialFiles = useCallback(() => {
    setMediaUploadInitialFiles(null);
  }, []);

  const handleMessagePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!selectedUser || broadcastGroupName || isLoading || sendingMedia) return;
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const blob = item.getAsFile();
        if (!blob || blob.size === 0) continue;
        const ext =
          blob.type === "image/jpeg" || blob.type === "image/jpg"
            ? "jpg"
            : blob.type === "image/png"
              ? "png"
              : blob.type === "image/webp"
                ? "webp"
                : "png";
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, {
          type: blob.type || "image/png",
        });
        e.preventDefault();
        setMediaUploadInitialFiles([file]);
        setShowMediaUpload(true);
        return;
      }
    },
    [selectedUser, broadcastGroupName, isLoading, sendingMedia],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COMPOSER_EMOJI_USAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        setComposerEmojiUsage(parsed as Record<string, number>);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!composerEmojiPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = composerEmojiWrapRef.current;
      if (el && !el.contains(e.target as Node)) {
        setComposerEmojiPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [composerEmojiPickerOpen]);

  const insertComposerEmoji = useCallback(
    (emoji: string) => {
      if (isLoading || sendingMedia) return;
      const ta = messageInputRef.current;
      const maxLen = 1000;
      const prev = messageInput;
      const start = ta ? ta.selectionStart ?? prev.length : prev.length;
      const end = ta ? ta.selectionEnd ?? prev.length : prev.length;
      const next = prev.slice(0, start) + emoji + prev.slice(end);
      if (next.length > maxLen) return;
      setMessageInput(next);
      setComposerEmojiUsage((u) => {
        const n = { ...u, [emoji]: (u[emoji] ?? 0) + 1 };
        try {
          localStorage.setItem(COMPOSER_EMOJI_USAGE_KEY, JSON.stringify(n));
        } catch {
          /* ignore */
        }
        return n;
      });
      setComposerEmojiPickerOpen(false);
      requestAnimationFrame(() => {
        const el = messageInputRef.current;
        if (!el) return;
        el.focus();
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
        adjustMessageInputHeight();
      });
    },
    [messageInput, isLoading, sendingMedia, adjustMessageInputHeight],
  );

  const loadReplyAgents = useCallback(async () => {
    setReplyAgentsLoading(true);
    try {
      const response = await fetch("/api/reply-agents");
      const result = await response.json();
      if (response.ok && Array.isArray(result.agents)) {
        setReplyAgents(
          result.agents.map((a: { id: string; name: string }) => ({
            id: a.id,
            name: a.name,
          })),
        );
      }
    } catch (e) {
      console.error("Load reply agents:", e);
    } finally {
      setReplyAgentsLoading(false);
    }
  }, []);

  const handleSuggestReply = useCallback(
    async (agentId: string | null) => {
      if (!selectedUser || broadcastGroupName || suggestingReply) return;

      const nonOptimistic = messages.filter((m) => !m.id.startsWith("optimistic_"));
      const hasConversation = nonOptimistic.length > 0;
      const mode =
        selectedUser.status_rule_mode === "hard" || selectedUser.status_rule_mode === "ai"
          ? selectedUser.status_rule_mode
          : resolvedStatusRuleMode;
      const ruleText =
        selectedUser.status_rule?.trim() || resolvedRuleText.trim();
      const hardRuleWithoutChat = mode === "hard" && ruleText.length > 0;

      if (!hasConversation && !hardRuleWithoutChat) {
        alert("No messages in this conversation yet.");
        return;
      }

      const recent = nonOptimistic.slice(-10);

      setSuggestingReply(true);
      try {
        const response = await fetch("/api/ai/suggest-reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: recent.map((m) => ({
              content: m.content,
              is_sent_by_me: m.is_sent_by_me,
              media: (() => {
                try {
                  if (!m.media_data) return undefined;
                  const md =
                    typeof m.media_data === "string" ? JSON.parse(m.media_data) : m.media_data;
                  if (!md || typeof md !== "object") return undefined;
                  return {
                    type: md.type,
                    mime_type: md.mime_type,
                    media_url: md.media_url,
                  };
                } catch {
                  return undefined;
                }
              })(),
            })),
            contactId: selectedUser.id,
            ...(agentId ? { agentId } : {}),
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Failed to get suggestion");
        }
        const suggestion = String(result.suggestion ?? "").trim();
        if (!suggestion) {
          throw new Error("Empty suggestion");
        }
        setMessageInput(suggestion.slice(0, 1000));
      } catch (err) {
        console.error("Suggest reply:", err);
        alert(err instanceof Error ? err.message : "Could not get a suggested reply.");
      } finally {
        setSuggestingReply(false);
      }
    },
    [
      selectedUser,
      broadcastGroupName,
      suggestingReply,
      messages,
      resolvedStatusRuleMode,
      resolvedRuleText,
    ],
  );

  const handleSendMedia = async (mediaFiles: MediaFile[]) => {
    // Don't allow media upload in broadcast mode for now
    if ((!selectedUser && !broadcastGroupName) || sendingMedia) return;
    
    if (broadcastGroupName) {
      alert('Media upload to broadcast groups is not yet supported. Please send text messages only.');
      return;
    }

    // TypeScript safety check
    if (!selectedUser) return;
    
    setSendingMedia(true);
    
    try {
      const formData = new FormData();
      formData.append('to', selectedUser.id);
      
      mediaFiles.forEach((mediaFile) => {
        formData.append('files', mediaFile.file);
        formData.append('captions', mediaFile.caption || '');
      });

      const response = await fetch('/api/send-media', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send media');
      }

      console.log('Media sent successfully:', result);
      
      // Show success message
      if (result.successCount > 0) {
        // You might want to show a toast notification here
        console.log(`Successfully sent ${result.successCount} of ${result.totalFiles} files`);
      }
      
      if (result.failureCount > 0) {
        alert(`Failed to send ${result.failureCount} files. Please try again.`);
      }

    } catch (error) {
      console.error('Error sending media:', error);
      alert(`Failed to send media: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingMedia(false);
    }
  };

  const sendEditedImageFromViewer = async (file: File) => {
    await handleSendMedia([
      {
        id: crypto.randomUUID(),
        file,
        type: "image",
        caption: "",
      },
    ]);
  };

  const handleUpdateName = async (userId: string, customName: string) => {
    if (onUpdateName) {
      await onUpdateName(userId, customName);
    }
  };

  const runDynamicAction = async () => {
    if (!selectedUser || broadcastGroupName) return;
    if (runningAction) return;

    const statusId = selectedUser.status_id ?? null;
    const tagName = selectedUser.status_name ?? undefined;

    if (!statusId && !tagName) {
      alert("This contact has no tag/status to run an action for.");
      return;
    }

    setRunningAction(true);
    try {
      const res = await fetch("/api/actions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: selectedUser.id,
          statusId,
          tagName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Action failed");
      }
      // Response is stored in contacts.metadata by the server; show quick confirmation.
      console.log("Dynamic action executed:", data);
      alert("Action executed. Response saved to conversation metadata.");
      await onUsersUpdate?.();
    } catch (e) {
      console.error("Run action:", e);
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setRunningAction(false);
    }
  };

  const getDisplayName = (user: ChatUser) => {
    return user.custom_name || user.whatsapp_name || user.name || user.id;
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString([], { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    }
  };

  const formatAudioDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAudioPlay = (messageId: string, audioUrl: string) => {
    // Stop any currently playing audio
    if (playingAudio && playingAudio !== messageId) {
      const currentAudio = audioRefs.current[playingAudio];
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    }

    // Toggle play/pause for the clicked audio
    const audio = audioRefs.current[messageId];
    if (audio) {
      if (playingAudio === messageId) {
        audio.pause();
        setPlayingAudio(null);
      } else {
        audio.play();
        setPlayingAudio(messageId);
      }
    } else {
      // Create new audio element
      const newAudio = new Audio(audioUrl);
      
      // Set up audio event listeners
      newAudio.onloadedmetadata = () => {
        setAudioDurations(prev => ({ ...prev, [messageId]: newAudio.duration }));
      };
      
      newAudio.ontimeupdate = () => {
        setAudioCurrentTime(prev => ({ ...prev, [messageId]: newAudio.currentTime }));
      };
      
      newAudio.onended = () => {
        setPlayingAudio(null);
        setAudioCurrentTime(prev => ({ ...prev, [messageId]: 0 }));
      };
      
      newAudio.onerror = () => {
        console.error('Error playing audio');
        setPlayingAudio(null);
      };
      
      audioRefs.current[messageId] = newAudio;
      newAudio.play();
      setPlayingAudio(messageId);
    }
  };

  const downloadMedia = async (url: string, filename: string, messageId?: string) => {
    try {
      const response =
        messageId &&
        (await fetch("/api/media/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, filename }),
        }).catch(() => null));

      const useProxy = response && response.ok;
      const finalResponse =
        useProxy && response
          ? response
          : await fetch(url, {
              method: "GET",
              mode: "cors",
              credentials: "omit",
            });

      if (!finalResponse.ok) {
        throw new Error(
          `Failed to download: ${finalResponse.status} ${finalResponse.statusText}`,
        );
      }

      const blob = await finalResponse.blob();
      
      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || 'download';
      link.style.display = 'none';
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      console.log('File downloaded successfully:', filename);
    } catch (error) {
      console.error('Error downloading media:', error);
      
      // Fallback: Open in new tab if direct download fails
      try {
        const newWindow = window.open(url, '_blank');
        if (!newWindow) {
          throw new Error('Popup blocked');
        }
      } catch (fallbackError) {
        console.error('Fallback download also failed:', fallbackError);
        alert('Unable to download file. Please try again or contact support.');
      }
    }
  };

  const refreshMediaUrl = async (messageId: string) => {
    if (!messageId) return;

    // Avoid spamming the API if media element repeatedly errors.
    // - only 1 in-flight per message
    // - only 1 attempt per message per page-load (manual refresh button still works by clearing this set if needed)
    // - cooldown window to avoid bursty retries during re-renders
    const now = Date.now();
    const last = lastRefreshAtRef.current[messageId] ?? 0;
    const COOLDOWN_MS = 5000;
    if (now - last < COOLDOWN_MS) return;
    lastRefreshAtRef.current[messageId] = now;
    if (refreshedOnceRef.current.has(messageId)) return;

    // Use a ref as an immediate lock to avoid rapid duplicate calls
    // (state updates are async and onError can fire multiple times quickly).
    if (refreshingUrlsRef.current.has(messageId)) return;
    refreshingUrlsRef.current.add(messageId);
    refreshedOnceRef.current.add(messageId);

    setRefreshingUrls(prev => new Set(prev).add(messageId));

    try {
      const response = await fetch('/api/media/refresh-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({ messageId }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Media URL refreshed:', result);
        if (result?.newUrl && typeof result.newUrl === "string") {
          setMediaUrlOverrides((prev) => ({ ...prev, [messageId]: result.newUrl }));
        }
      } else {
        const txt = await response.text();
        console.error('Failed to refresh media URL:', txt);
      }
    } catch (error) {
      console.error('Error refreshing media URL:', error);
    } finally {
      refreshingUrlsRef.current.delete(messageId);
      setRefreshingUrls(prev => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
    }
  };

  const handleMediaLoad = (messageId: string) => {
    setLoadingMedia(prev => {
      const newSet = new Set(prev);
      newSet.delete(messageId);
      return newSet;
    });
    ensurePinnedToBottom();
  };

  const handleMediaLoadStart = (messageId: string) => {
    setLoadingMedia(prev => new Set(prev).add(messageId));
  };

  const messageTimestampRow = (message: Message, isOwn: boolean) => {
    const showTicks =
      messagingProvider === "green_api" &&
      isOwn &&
      !message.id.startsWith("optimistic_");
    let greenStatus: string | null = null;
    if (showTicks && message.media_data) {
      try {
        const md =
          typeof message.media_data === "string"
            ? (JSON.parse(message.media_data) as Record<string, unknown>)
            : (message.media_data as Record<string, unknown>);
        const s = md.green_recipient_status;
        if (typeof s === "string") greenStatus = s.toLowerCase();
      } catch {
        /* ignore */
      }
    }
    const color = isOwn ? "text-emerald-50/90" : "text-muted-foreground";
    return (
      <span className={`inline-flex items-center gap-1.5 ${color}`}>
        <span>{formatTime(message.timestamp)}</span>
        {showTicks && <GreenOutgoingTicks status={greenStatus} />}
      </span>
    );
  };

  const renderMessageContent = (message: Message, isOwn: boolean) => {
    const messageType = message.message_type || 'text';
    let mediaData: MediaData | null = null;

    if (message.media_data) {
      try {
        // Check if media_data is already an object or a string
        if (typeof message.media_data === 'string') {
          mediaData = JSON.parse(message.media_data);
        } else if (typeof message.media_data === 'object') {
          // Already an object, use it directly
          mediaData = message.media_data as unknown as MediaData;
        }
      } catch (error) {
        console.error('Error parsing media data:', error, 'Type:', typeof message.media_data);
      }
    }

    const baseClasses = `max-w-[85%] min-w-0 px-4 py-3 rounded-2xl shadow-sm ${
      isOwn
        ? 'bg-emerald-600 text-white ml-4 ring-1 ring-emerald-700/30 dark:bg-emerald-700 dark:ring-emerald-900/40'
        : 'bg-white dark:bg-muted border border-border mr-4'
    }`;

    const isRefreshing = refreshingUrls.has(message.id);
    const isMediaLoading = loadingMedia.has(message.id);
    const effectiveMediaUrl =
      mediaUrlOverrides[message.id] || mediaData?.media_url || undefined;
    const isPresignedR2Url =
      typeof effectiveMediaUrl === "string" &&
      (effectiveMediaUrl.includes("X-Amz-Signature=") ||
        effectiveMediaUrl.includes("X-Amz-Credential=") ||
        effectiveMediaUrl.includes("X-Amz-Date="));

    switch (messageType) {
      case 'image':
        return (
          <div className={baseClasses}>
            {renderQuoteStripe(message, isOwn)}
            {effectiveMediaUrl && mediaData?.s3_uploaded ? (
              <div className="mb-2 relative overflow-hidden rounded-xl">
                {isMediaLoading && (
                  <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center rounded-xl">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                      <span className="text-xs text-gray-500">Loading image...</span>
                    </div>
                  </div>
                )}
                <Image
                  src={effectiveMediaUrl}
                  alt={mediaData.caption || "Shared image"}
                  width={300}
                  height={200}
                  className="max-w-[300px] max-h-[400px] w-auto h-auto object-cover cursor-pointer rounded-xl"
                  style={{ maxWidth: '100%', height: 'auto' }}
                  onClick={() =>
                    setImageViewer({
                      url: effectiveMediaUrl,
                      filename:
                        (typeof mediaData?.filename === "string" &&
                          mediaData.filename) ||
                        `image-${message.id.slice(0, 8)}.jpg`,
                      messageId: message.id,
                    })
                  }
                  onLoadingComplete={() => handleMediaLoad(message.id)}
                  onLoadStart={() => handleMediaLoadStart(message.id)}
                  onError={() => {
                    console.log('Next.js Image failed to load, attempting to refresh URL');
                    handleMediaLoad(message.id);
                    refreshMediaUrl(message.id);
                  }}
                  priority={false}
                  placeholder="blur"
                  blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAACAQMDBQAAAAAAAAAAAAABAgMABAUGIWGRkqGx0f/EABUBAQEAAAAAAAAAAAAAAAAAAAMF/8QAGhEAAgIDAAAAAAAAAAAAAAAAAAECEgMRkf/aAAwDAQACEQMRAD8AltJagyeH0AthI5xdrLcNM91BF5pX2HaH9bcfaSXWGaRmknyJckliyjqTzSlT54b6bk+h0R+Rq19G9D/Z"
                  // Presigned URLs are time-bound; avoid Next's server-side optimizer fetch.
                  unoptimized={isPresignedR2Url}
                />
                {isRefreshing && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-xl">
                    <RefreshCw className="h-6 w-6 text-white animate-spin" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 bg-gray-100 dark:bg-gray-800 rounded-xl mb-2">
                <ImageIcon className="h-8 w-8 text-gray-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Image</p>
                  <p className="text-xs text-gray-500">Loading...</p>
                </div>
                {mediaData?.s3_uploaded === false && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="p-2 h-8 w-8"
                    onClick={() => refreshMediaUrl(message.id)}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            )}
            {mediaData?.caption && (
              <p className="text-sm whitespace-pre-wrap break-words mb-2">
                {mediaData.caption}
              </p>
            )}
            <div
              className={`text-xs mt-0.5 flex w-full ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {messageTimestampRow(message, isOwn)}
            </div>
          </div>
        );

      case 'document':
        return (
          <div className={baseClasses}>
            {renderQuoteStripe(message, isOwn)}
            <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl mb-2 min-w-0 w-full max-w-full sm:min-w-[280px] sm:max-w-[400px]">
              <div className={`p-3 rounded-full ${isOwn ? 'bg-emerald-700' : 'bg-blue-500'}`}>
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-gray-800 dark:text-gray-200">
                  {mediaData?.filename || 'Document'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {mediaData?.mime_type}
                </p>
                {isMediaLoading && (
                  <p className="text-xs text-blue-500 mt-1">Preparing download...</p>
                )}
              </div>
              {effectiveMediaUrl && mediaData?.s3_uploaded && (
                <Button
                  size="sm"
                  variant="ghost"
                  className={`p-2 h-10 w-10 ${isOwn ? 'hover:bg-emerald-800/40' : 'hover:bg-gray-200'}`}
                  onClick={() =>
                    downloadMedia(
                      effectiveMediaUrl,
                      mediaData?.filename || "document",
                      message.id,
                    )
                  }
                  disabled={isRefreshing}
                >
                  {isRefreshing ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <Download className="h-5 w-5" />
                  )}
                </Button>
              )}
              {(!mediaData?.media_url || !mediaData.s3_uploaded) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className={`p-2 h-10 w-10 ${isOwn ? 'hover:bg-emerald-800/40' : 'hover:bg-gray-200'}`}
                  onClick={() => refreshMediaUrl(message.id)}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              )}
            </div>
            <div
              className={`text-xs mt-0.5 flex w-full ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {messageTimestampRow(message, isOwn)}
            </div>
          </div>
        );

      case 'audio':
        const duration = audioDurations[message.id] || 0;
        const currentTime = audioCurrentTime[message.id] || 0;
        const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
        
        return (
          <div className={baseClasses}>
            {renderQuoteStripe(message, isOwn)}
            <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl mb-2 min-w-0 w-full max-w-full sm:min-w-[300px] sm:max-w-[400px]">
              <Button
                size="sm"
                variant="ghost"
                className={`p-3 rounded-full ${isOwn ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-500 hover:bg-blue-600'} text-white`}
                onClick={() => effectiveMediaUrl && handleAudioPlay(message.id, effectiveMediaUrl)}
                disabled={!effectiveMediaUrl || !mediaData?.s3_uploaded || isRefreshing}
              >
                {isRefreshing ? (
                  <RefreshCw className="h-5 w-5 animate-spin" />
                ) : playingAudio === message.id ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>
              
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Volume2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {mediaData?.voice ? 'Voice Message' : 'Audio'}
                  </span>
                  {(!mediaData?.media_url || !mediaData.s3_uploaded) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="p-1 h-6 w-6 ml-auto"
                      onClick={() => refreshMediaUrl(message.id)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
                
                {/* Audio Progress Bar */}
                <div className="relative">
                  <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        isOwn ? 'bg-emerald-300/90' : 'bg-blue-400'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-gray-500">
                      {formatAudioDuration(currentTime)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {duration > 0 ? formatAudioDuration(duration) : '--:--'}
                    </span>
                  </div>
                </div>
                
                {isMediaLoading && (
                  <p className="text-xs text-blue-500 mt-1">Loading audio...</p>
                )}
              </div>
            </div>
            <div
              className={`text-xs mt-0.5 flex w-full ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {messageTimestampRow(message, isOwn)}
            </div>
          </div>
        );

      case 'video':
        return (
          <div className={baseClasses}>
            {renderQuoteStripe(message, isOwn)}
            {effectiveMediaUrl && mediaData?.s3_uploaded ? (
              <div className="mb-2 relative overflow-hidden rounded-xl max-w-[400px] max-h-[300px]">
                {isMediaLoading && (
                  <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center rounded-xl z-10">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                      <span className="text-xs text-gray-500">Loading video...</span>
                    </div>
                  </div>
                )}
                <video 
                  controls
                  className="max-w-[400px] max-h-[300px] w-auto h-auto rounded-xl"
                  preload="metadata"
                  onLoadStart={() => handleMediaLoadStart(message.id)}
                  onCanPlay={() => handleMediaLoad(message.id)}
                  onError={() => {
                    console.log('Video failed to load, attempting to refresh URL');
                    handleMediaLoad(message.id);
                    refreshMediaUrl(message.id);
                  }}
                >
                  <source src={effectiveMediaUrl} type={mediaData?.mime_type} />
                  Your browser does not support the video tag.
                </video>
                {isRefreshing && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-xl z-20">
                    <RefreshCw className="h-6 w-6 text-white animate-spin" />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 bg-gray-100 dark:bg-gray-800 rounded-xl mb-2">
                <Play className="h-8 w-8 text-gray-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Video</p>
                  <p className="text-xs text-gray-500">Loading...</p>
                </div>
                {(!mediaData?.media_url || !mediaData.s3_uploaded) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="p-2 h-8 w-8"
                    onClick={() => refreshMediaUrl(message.id)}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            )}
            {mediaData?.caption && (
              <p className="text-sm whitespace-pre-wrap break-words mb-2">
                {mediaData.caption}
              </p>
            )}
            <div
              className={`text-xs mt-1 flex w-full ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {messageTimestampRow(message, isOwn)}
            </div>
          </div>
        );

      case 'template':
        // Template message - display final rendered content cleanly
        return (
          <div className={baseClasses}>
            {renderQuoteStripe(message, isOwn)}
            {/* Template Content - Clean Display */}
            <div className="space-y-3">
              {/* Header Component */}
              {mediaData?.header && (
                <div>
                  {mediaData.header.format === 'IMAGE' && mediaData.header.media_url ? (
                    <div className="mb-3 rounded-lg overflow-hidden">
                      <Image
                        src={mediaData.header.media_url}
                        alt="Template header image"
                        width={250}
                        height={150}
                        className="max-w-full h-auto object-cover rounded-lg"
                        style={{ maxWidth: '100%', height: 'auto' }}
                        unoptimized={
                          mediaData.header.media_url.includes("X-Amz-Signature=") ||
                          mediaData.header.media_url.includes("X-Amz-Credential=") ||
                          mediaData.header.media_url.includes("X-Amz-Date=")
                        }
                      />
                    </div>
                  ) : mediaData.header.format === 'VIDEO' && mediaData.header.media_url ? (
                    <div className="mb-3 rounded-lg overflow-hidden">
                      <video 
                        controls
                        className="max-w-full h-auto rounded-lg"
                        preload="metadata"
                      >
                        <source src={mediaData.header.media_url} type="video/mp4" />
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  ) : mediaData.header.format === 'DOCUMENT' && mediaData.header.media_url ? (
                    <div className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg mb-3">
                      <FileText className="h-5 w-5 text-gray-600" />
                      <span className="text-sm font-medium">{mediaData.header.filename || 'Document'}</span>
                    </div>
                  ) : mediaData.header.text ? (
                    <div className="mb-3">
                      <p className="text-base font-semibold leading-relaxed">
                        {mediaData.header.text}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Body Component */}
              {mediaData?.body && (
                <div>
                  <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {mediaData.body.text || message.content}
                  </p>
                </div>
              )}

              {/* If no structured data, show the processed content */}
              {!mediaData?.body && !mediaData?.header && (
                <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                  {message.content}
                </p>
              )}

              {/* Footer Component */}
              {mediaData?.footer && (
                <div className="mt-2">
                  <p className="text-xs opacity-75 leading-relaxed">
                    {mediaData.footer.text}
                  </p>
                </div>
              )}

              {/* Buttons Component */}
              {mediaData?.buttons && mediaData.buttons.length > 0 && (
                <div className="mt-4">
                  <div className="space-y-2">
                    {mediaData.buttons.map((button: {
                      type: string;
                      text: string;
                      url?: string;
                      phone_number?: string;
                    }, index: number) => (
                      <div
                        key={index}
                        className={`
                          px-4 py-3 rounded-lg border border-opacity-30 border-current text-center font-medium
                          ${isOwn 
                            ? 'bg-white bg-opacity-20 hover:bg-opacity-30' 
                            : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }
                          cursor-pointer transition-colors
                        `}
                        onClick={() => {
                          if (button.type === 'URL' && button.url) {
                            window.open(button.url, '_blank');
                          } else if (button.type === 'PHONE_NUMBER' && button.phone_number) {
                            window.open(`tel:${button.phone_number}`, '_self');
                          }
                        }}
                      >
                        <div className="flex items-center justify-center gap-2">
                          {button.type === 'URL' && (
                            <>
                              <span className="text-base">🔗</span>
                              <span className="text-sm">{button.text}</span>
                            </>
                          )}
                          {button.type === 'PHONE_NUMBER' && (
                            <>
                              <span className="text-base">📞</span>
                              <span className="text-sm">{button.text}</span>
                            </>
                          )}
                          {button.type === 'QUICK_REPLY' && (
                            <>
                              <span className="text-base">💬</span>
                              <span className="text-sm">{button.text}</span>
                            </>
                          )}
                          {!['URL', 'PHONE_NUMBER', 'QUICK_REPLY'].includes(button.type) && (
                            <span className="text-sm">{button.text}</span>
                          )}
                        </div>
                        {button.url && (
                          <div className="text-xs opacity-60 mt-2 truncate border-t border-opacity-20 border-current pt-2">
                            {button.url}
                          </div>
                        )}
                        {button.phone_number && (
                          <div className="text-xs opacity-60 mt-2 border-t border-opacity-20 border-current pt-2">
                            {button.phone_number}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div
              className={`text-xs mt-3 flex w-full ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {messageTimestampRow(message, isOwn)}
            </div>
          </div>
        );

      default:
        // Text message or fallback
        const isOptimistic = message.id.startsWith('optimistic_');
        
        return (
          <div className={`${baseClasses} ${isOptimistic ? 'opacity-70' : ''} transition-opacity duration-300`}>
            {renderQuoteStripe(message, isOwn)}
            <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
            <div
              className={`flex items-center gap-2 mt-2 flex-wrap ${isOwn ? "justify-end" : "justify-start"}`}
            >
              {messageTimestampRow(message, isOwn)}
              {isOptimistic && isOwn && (
                <span className="text-xs text-emerald-100 flex items-center gap-1">
                  <span className="inline-block w-1 h-1 bg-emerald-200 rounded-full animate-pulse"></span>
                  Sending...
                </span>
              )}
            </div>
          </div>
        );
    }
  };

  const messageCountForSuggest = useMemo(
    () => messages.filter((m) => !m.id.startsWith("optimistic_")).length,
    [messages],
  );
  const hasConversationForSuggest = messageCountForSuggest > 0;
  const effectiveStatusRuleMode =
    selectedUser?.status_rule_mode === "hard" || selectedUser?.status_rule_mode === "ai"
      ? selectedUser.status_rule_mode
      : resolvedStatusRuleMode;
  const effectiveStatusRuleText =
    (selectedUser?.status_rule?.trim() || resolvedRuleText.trim()) ?? "";
  const hardSuggestWithoutMessages =
    effectiveStatusRuleMode === "hard" && effectiveStatusRuleText.length > 0;
  const suggestReplyBlockedByEmptyHistory =
    !hasConversationForSuggest && !hardSuggestWithoutMessages;

  // Group messages by date
  const groupedMessages = messages.reduce((groups: { [key: string]: Message[] }, message) => {
    const date = new Date(message.timestamp).toDateString();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {});

  // Show welcome screen only if neither individual user nor broadcast group is selected
  if (!selectedUser && !broadcastGroupName) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-muted/20">
        <MessageCircle className="h-24 w-24 text-muted-foreground/50 mb-6" />
        <h2 className="text-2xl font-semibold text-muted-foreground mb-2">
          Welcome to WhatsApp Web
        </h2>
        <p className="text-muted-foreground text-center max-w-md">
          Select a conversation from the sidebar to start messaging, or create a new chat.
        </p>
        <p className="text-sm text-muted-foreground mt-4 opacity-75">
          Press <kbd className="px-2 py-1 bg-muted rounded text-xs">ESC</kbd> to close chat window
        </p>
      </div>
    );
  }

  return (
    <div 
      className="relative flex h-full min-h-0 flex-col bg-background"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {devComposeOpen && devComposeKind && isLocalhostDev && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dev-compose-title"
          onClick={() => {
            setDevComposeOpen(false);
            setDevComposeKind(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="dev-compose-title"
              className="text-lg font-semibold mb-1"
            >
              Test message (localhost)
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Leave empty to use the default dev placeholder. Your text is
              inserted as-is.
            </p>
            {(devComposeKind === "in" || devComposeKind === "both") && (
              <div className="space-y-2 mb-4">
                <Label htmlFor="dev-inbound-text">
                  {devComposeKind === "both" ? "Inbound" : "Message text"}
                </Label>
                <Textarea
                  id="dev-inbound-text"
                  value={devTextInbound}
                  onChange={(e) => setDevTextInbound(e.target.value)}
                  placeholder="Inbound message content…"
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
            )}
            {(devComposeKind === "out" || devComposeKind === "both") && (
              <div className="space-y-2 mb-6">
                <Label htmlFor="dev-outbound-text">
                  {devComposeKind === "both" ? "Outbound" : "Message text"}
                </Label>
                <Textarea
                  id="dev-outbound-text"
                  value={devTextOutbound}
                  onChange={(e) => setDevTextOutbound(e.target.value)}
                  placeholder="Outbound message content…"
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDevComposeOpen(false);
                  setDevComposeKind(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submitDevCompose()}
                disabled={devInsertLoading}
              >
                {devInsertLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Inserting…
                  </>
                ) : (
                  "Insert"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Chat Header — sticky on mobile so back / avatar / title stay visible while scrolling */}
      <div
        className={`flex shrink-0 items-center gap-3 border-b border-border ${
          isMobile
            ? "sticky top-0 z-30 bg-background/95 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-background/80"
            : "bg-muted/50 p-4"
        }`}
      >
        {isMobile && onBack && (
          <button 
            onClick={onBack}
            className="p-2 hover:bg-muted rounded-full transition-colors"
            title="Back to contacts"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        {broadcastGroupName ? (
          <>
            {/* Broadcast Group Header */}
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-emerald-600 text-white font-semibold">
                <Users className="h-5 w-5" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                {broadcastGroupName}
                <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                  Broadcast
                </span>
              </h2>
              <p className="text-sm text-muted-foreground">
                {isLoading ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Sending broadcast...
                  </span>
                ) : (
                  'Send message to all group members'
                )}
              </p>
            </div>
          </>
        ) : selectedUser ? (
          <>
            {/* Individual Chat Header */}
            <Avatar className="h-10 w-10">
              {selectedUser.avatar_url ? (
                <AvatarImage
                  src={selectedUser.avatar_url}
                  alt={getDisplayName(selectedUser)}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <AvatarFallback className="bg-emerald-100 text-emerald-800 font-semibold">
                {selectedUser.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div 
              className="flex-1 cursor-pointer hover:bg-muted/50 rounded-lg p-2 -m-2 transition-colors"
              onClick={() => setShowUserInfo(true)}
              title="View contact info"
            >
              <h2 className="font-semibold text-foreground">{getDisplayName(selectedUser)}</h2>
              <p className="text-sm text-muted-foreground">
                {isLoading || sendingMedia ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {sendingMedia ? 'Sending media...' : 'Sending message...'}
                  </span>
                ) : (
                  `Last seen ${formatTime(selectedUser.last_active)}`
                )}
              </p>
            </div>

            {!broadcastGroupName && (
              (() => {
                const statusId = selectedUser.status_id ?? null;
                const hasTag = !!(selectedUser.status_id || selectedUser.status_name);
                const hasMapping = statusId ? mappedStatusIds.has(statusId) : false;
                const disabled = runningAction || !hasTag || (statusId ? !hasMapping : true);

                return (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void runDynamicAction()}
                disabled={disabled}
                title={
                  !hasTag
                    ? "No tag/status on this contact"
                    : !hasMapping
                      ? "No action mapping for this tag"
                      : "Run dynamic action for this tag"
                }
              >
                {runningAction ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running…
                  </>
                ) : (
                  "Run action"
                )}
              </Button>
                );
              })()
            )}
            {isLocalhostDev && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 gap-1 border-amber-500/50 px-2 text-xs text-amber-800 dark:text-amber-300"
                    disabled={devInsertLoading}
                    title="Insert test messages (localhost only)"
                  >
                    {devInsertLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FlaskConical className="h-3.5 w-3.5" />
                    )}
                    Dev
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Test (localhost)</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => openDevCompose("in")}
                  >
                    Inbound
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openDevCompose("out")}
                  >
                    Outbound
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openDevCompose("both")}
                  >
                    Both
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => void handleDeleteConversation()}
                  >
                    Delete conversation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        ) : null}
        {!isMobile && onClose && (
          <button 
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
            title="Close chat (ESC)"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {selectedUser && !broadcastGroupName && (
        <div className="px-4 py-2 border-b border-border bg-muted/30 flex justify-end shrink-0">
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) {
                void loadReplyAgents();
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 text-xs sm:text-sm"
                disabled={
                  suggestingReply ||
                  isLoading ||
                  sendingMedia ||
                  suggestReplyBlockedByEmptyHistory
                }
                title={
                  hardSuggestWithoutMessages && !hasConversationForSuggest
                    ? "Uses your Hard status rule as the suggested reply (no chat history needed)."
                    : "Choose an AI assistant and draft a reply from the last 10 messages"
                }
              >
                {suggestingReply ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Suggesting…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Suggest reply
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {replyAgentsLoading ? "Loading assistants…" : "Choose an assistant"}
              </DropdownMenuLabel>
              <DropdownMenuItem
                disabled={
                  suggestingReply ||
                  isLoading ||
                  sendingMedia ||
                  suggestReplyBlockedByEmptyHistory
                }
                onSelect={() => {
                  void handleSuggestReply(null);
                }}
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                Default assistant
              </DropdownMenuItem>
              {replyAgents.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  disabled={
                    suggestingReply ||
                    isLoading ||
                    sendingMedia ||
                    suggestReplyBlockedByEmptyHistory
                  }
                  onSelect={() => {
                    void handleSuggestReply(a.id);
                  }}
                >
                  {a.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/protected/reply-agents">Manage reply agents…</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Messages Area */}
      <div 
        ref={messagesContainerRef}
        onScroll={onMessagesScroll}
        style={{ overflowAnchor: "none" }}
        className="min-h-0 flex-1 overflow-y-auto p-4 bg-gradient-to-b from-emerald-50/40 to-blue-50/30 dark:from-emerald-950/15 dark:to-blue-950/10"
      >
        {!broadcastGroupName && isMessagesLoading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin opacity-60" aria-hidden />
            <p className="text-xs">Loading…</p>
          </div>
        ) : Object.keys(groupedMessages).length === 0 ? (
          // No messages - show appropriate placeholder
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            {broadcastGroupName ? (
              <>
                <Users className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">Broadcast to {broadcastGroupName}</p>
                <p className="text-sm text-center max-w-md">
                  Messages sent here will be delivered to all members in this group individually.
                  Each member will receive the message as a personal message from you.
                </p>
              </>
            ) : (
              <>
                <MessageCircle className="h-16 w-16 mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">No messages yet</p>
                <p className="text-sm text-center">
                  Start the conversation by sending a message below
                </p>
              </>
            )}
          </div>
        ) : (
          <div ref={messagesInnerRef} className="space-y-4">
            {Object.entries(groupedMessages).map(([date, dayMessages]) => (
              <div key={date}>
                {/* Date Separator */}
                <div className="flex justify-center my-6">
                  <span className="bg-background/80 text-muted-foreground text-xs px-4 py-2 rounded-full border shadow-sm">
                    {formatDate(dayMessages[0].timestamp)}
                  </span>
                </div>

                {/* Messages for this date */}
                <div className="space-y-3">
                  {dayMessages.map((message) => {
                    // Use is_sent_by_me field instead of comparing IDs to determine message ownership
                    const isOwn = message.is_sent_by_me;

                    const globalIndex = messages.findIndex(m => m.id === message.id);
                    const isFirstUnread = globalIndex === firstUnreadIndex;

                    return (
                      <div key={message.id}>
                        {/* Unread messages indicator */}
                        {isFirstUnread && hasUnreadMessages && (
                          <div 
                            className="flex items-center justify-center my-4 animate-fade-in"
                          >
                            <div className="flex-1 h-px bg-red-500"></div>
                            <div className="px-3 py-1 bg-red-500 text-white text-xs font-medium rounded-full shadow-lg">
                              {unreadMessages.length} unread message{unreadMessages.length !== 1 ? 's' : ''}
                            </div>
                            <div className="flex-1 h-px bg-red-500"></div>
                          </div>
                        )}
                        
                        <div
                          className={`group flex items-start gap-1 ${isOwn ? "justify-end" : "justify-start"}`}
                        >
                          {isLocalhostDev &&
                            !message.id.startsWith("optimistic_") && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteTestMessage(message.id)}
                                disabled={deletingMessageId === message.id}
                                className="mt-1 shrink-0 rounded p-1.5 text-muted-foreground opacity-70 transition-opacity hover:bg-destructive/15 hover:text-destructive hover:opacity-100 disabled:opacity-40"
                                title="Supprimer (mode test)"
                              >
                                {deletingMessageId === message.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          <div
                            className={`flex min-w-0 flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}
                          >
                            {renderMessageContent(message, isOwn)}
                            {messagingProvider &&
                              !broadcastGroupName &&
                              !message.id.startsWith("optimistic_") && (
                                <div
                                  className={`flex flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}
                                >
                                  <div
                                    className={`flex flex-wrap items-center gap-0.5 px-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 ${isOwn ? "justify-end" : "justify-start"}`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyingTo(message);
                                        messageInputRef.current?.focus();
                                      }}
                                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                      title="Reply"
                                    >
                                      <Reply className="h-4 w-4" />
                                    </button>
                                    {onSendReaction && (
                                      <button
                                        type="button"
                                        className="md:hidden rounded p-1 text-muted-foreground/30 hover:text-muted-foreground/50 focus-visible:text-muted-foreground/60 focus-visible:outline-none"
                                        aria-label={
                                          messagingProvider === "green_api"
                                            ? "Emoji replies (quoted)"
                                            : "Reactions"
                                        }
                                        aria-expanded={
                                          reactionEmojiMenuMessageId === message.id
                                        }
                                        title={
                                          messagingProvider === "green_api"
                                            ? "Emoji sends as a quoted reply (not a sticker reaction — Green API)"
                                            : "Reactions"
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setReactionEmojiMenuMessageId((prev) =>
                                            prev === message.id ? null : message.id,
                                          );
                                        }}
                                      >
                                        <Smile className="h-4 w-4 stroke-[1.25]" />
                                      </button>
                                    )}
                                    {onSendReaction && (
                                      <span className="hidden md:contents">
                                        {QUICK_REACTION_EMOJIS.map((em) => (
                                          <button
                                            key={`${message.id}-desk-${em}`}
                                            type="button"
                                            disabled={reactionBusyId === message.id}
                                            onClick={() => {
                                              void (async () => {
                                                setReactionBusyId(message.id);
                                                try {
                                                  await onSendReaction(message.id, em);
                                                } finally {
                                                  setReactionBusyId(null);
                                                }
                                              })();
                                            }}
                                            className="rounded px-1 py-0.5 text-base leading-none hover:bg-muted disabled:opacity-50"
                                            title={quickReactionButtonTitle(
                                              messagingProvider,
                                              em,
                                            )}
                                          >
                                            {em}
                                          </button>
                                        ))}
                                      </span>
                                    )}
                                  </div>
                                  {onSendReaction &&
                                    reactionEmojiMenuMessageId === message.id && (
                                      <div
                                        className={`flex md:hidden flex-wrap items-center gap-0.5 px-0.5 ${isOwn ? "justify-end" : "justify-start"}`}
                                      >
                                        {QUICK_REACTION_EMOJIS.map((em) => (
                                          <button
                                            key={`${message.id}-mob-${em}`}
                                            type="button"
                                            disabled={reactionBusyId === message.id}
                                            onClick={() => {
                                              void (async () => {
                                                setReactionBusyId(message.id);
                                                try {
                                                  await onSendReaction(message.id, em);
                                                } finally {
                                                  setReactionBusyId(null);
                                                }
                                                setReactionEmojiMenuMessageId(null);
                                              })();
                                            }}
                                            className="rounded px-1 py-0.5 text-base leading-none hover:bg-muted disabled:opacity-50"
                                            title={quickReactionButtonTitle(
                                              messagingProvider,
                                              em,
                                            )}
                                          >
                                            {em}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="border-t border-border bg-background">
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Replying to
              </p>
              <p className="truncate text-muted-foreground">{replyPreviewSnippet(replyingTo)}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => setReplyingTo(null)}
              aria-label="Cancel reply"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        <div className="p-4">
        <form onSubmit={handleSendMessage} className="flex gap-3 items-end">
          {/* Hide media button in broadcast mode, show template button */}
          {!broadcastGroupName && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowMediaUpload(true)}
              className="p-2 hover:bg-muted rounded-full transition-colors"
              title="Attach media"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
          )}
          {/* WhatsApp Cloud: Meta templates · Green API: saved messages → composer */}
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                messagingProvider === "green_api"
                  ? setShowSavedMessagePicker(true)
                  : setShowTemplateSelector(true)
              }
              className="p-2 hover:bg-muted rounded-full transition-colors"
              title={
                messagingProvider === "green_api"
                  ? "Insert saved message"
                  : "Send template"
              }
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
            {selectedUser && !broadcastGroupName && (
              <div className="relative" ref={contactDataWrapRef}>
                <ContactDataTriggerButton
                  active={contactDataOpen}
                  onClick={() => setContactDataOpen((o) => !o)}
                  disabled={isLoading || sendingMedia}
                />
                <ContactDataPopover
                  open={contactDataOpen}
                  onOpenChange={setContactDataOpen}
                  contactPhone={selectedUser.id}
                  contactDisplayName={contactDisplayName}
                  onAppendComposer={(chunk) => {
                    setMessageInput((prev) => (prev + chunk).slice(0, 1000));
                    requestAnimationFrame(() => {
                      messageInputRef.current?.focus();
                      adjustMessageInputHeight();
                    });
                  }}
                />
              </div>
            )}
          </div>
          <div
            ref={composerEmojiWrapRef}
            className="relative min-w-0 flex-1"
          >
            <Textarea
              ref={messageInputRef}
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleMessageInputKeyDown}
              onPaste={handleMessagePaste}
              placeholder={
                isLoading || sendingMedia
                  ? "Sending..."
                  : broadcastGroupName
                    ? "Type broadcast message..."
                    : "Type a message..."
              }
              title="Enter to send · Shift+Enter for a new line · Paste (Ctrl+V) image to attach"
              rows={1}
              className="min-h-[42px] max-h-[160px] w-full resize-none overflow-y-auto rounded-2xl border-border py-2.5 pl-11 pr-4 focus-visible:ring-emerald-500"
              maxLength={1000}
              disabled={isLoading || sendingMedia}
              autoFocus={!isMobile}
            />
            <button
              type="button"
              className="absolute bottom-2 left-2 z-10 rounded-full p-1.5 text-muted-foreground opacity-70 transition-colors hover:bg-muted hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-40"
              title="Insert emoji"
              aria-expanded={composerEmojiPickerOpen}
              aria-haspopup="dialog"
              aria-label="Insert emoji"
              disabled={isLoading || sendingMedia}
              onClick={(e) => {
                e.preventDefault();
                setComposerEmojiPickerOpen((o) => !o);
              }}
            >
              <Smile className="h-5 w-5" />
            </button>
            {composerEmojiPickerOpen && (
              <div
                role="dialog"
                aria-label="Emoji picker"
                className="absolute bottom-full left-0 z-50 mb-2 max-h-56 w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-lg"
              >
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Most used first
                </div>
                <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-9">
                  {sortedComposerEmojis.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className="flex h-9 items-center justify-center rounded-md text-lg leading-none hover:bg-muted/80 active:scale-95"
                      title={em}
                      onClick={() => insertComposerEmoji(em)}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button 
            type="submit" 
            disabled={!messageInput.trim() || isLoading || sendingMedia}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading || sendingMedia ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        </div>
      </div>

      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center z-40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-2xl border-2 border-emerald-500/70 border-dashed">
            <Paperclip className="h-16 w-16 text-emerald-600 mx-auto mb-4" />
            <p className="text-2xl font-semibold text-gray-900 dark:text-white text-center mb-2">
              Drop files to send
            </p>
            <p className="text-gray-500 dark:text-gray-400 text-center">
              Release to upload and send media
            </p>
          </div>
        </div>
      )}

      {/* Media Upload Modal - Only in individual chat mode */}
      {selectedUser && (
        <MediaUpload
          isOpen={showMediaUpload}
          onClose={() => setShowMediaUpload(false)}
          onSend={handleSendMedia}
          selectedUser={selectedUser}
          initialFiles={mediaUploadInitialFiles}
          onInitialFilesConsumed={clearMediaUploadInitialFiles}
        />
      )}

      <ImageViewerDialog
        isOpen={!!imageViewer}
        onClose={() => setImageViewer(null)}
        imageUrl={imageViewer?.url ?? ""}
        downloadFilename={imageViewer?.filename ?? "image"}
        messageId={imageViewer?.messageId}
        onDownload={downloadMedia}
        onSendEdited={
          selectedUser && !broadcastGroupName
            ? sendEditedImageFromViewer
            : undefined
        }
        sending={sendingMedia}
      />

      {/* Meta message templates (WhatsApp Cloud only in practice) */}
      {(selectedUser || broadcastGroupName) &&
        messagingProvider !== "green_api" && (
        <TemplateSelector
          isOpen={showTemplateSelector}
          onClose={() => setShowTemplateSelector(false)}
          onSendTemplate={handleSendTemplate}
          selectedUser={selectedUser || { 
            id: 'broadcast', 
            name: broadcastGroupName || 'Broadcast Group',
            last_active: new Date().toISOString()
          }}
        />
      )}

      {/* Green API: paste saved DB text into composer */}
      {(selectedUser || broadcastGroupName) &&
        messagingProvider === "green_api" && (
          <SavedMessagePicker
            isOpen={showSavedMessagePicker}
            onClose={() => setShowSavedMessagePicker(false)}
            onInsert={(text) => {
              setMessageInput(text.slice(0, 1000));
              requestAnimationFrame(() => {
                messageInputRef.current?.focus();
                adjustMessageInputHeight();
              });
            }}
          />
        )}

      {/* User Info Dialog - Only in individual chat mode */}
      {selectedUser && (
        <UserInfoDialog
          isOpen={showUserInfo}
          onClose={() => setShowUserInfo(false)}
          user={selectedUser}
          onUpdateName={handleUpdateName}
          onUsersUpdate={onUsersUpdate}
        />
      )}
    </div>
  );
} 