"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserList } from "@/components/chat/user-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { AlertCircle, Settings } from "lucide-react";
import Link from "next/link";

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
  avatar_url?: string | null;
  last_active: string;
  unread_count?: number;
  last_message_time?: string;
  last_message?: string;
  last_message_type?: string;
  last_message_sender?: string;
  status_id?: string | null;
  status_name?: string | null;
  status_color?: string | null;
  status_rule?: string | null;
  status_rule_mode?: "ai" | "hard" | null;
  auto_translate_enabled?: boolean | null;
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
}

interface MessagePayload {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  timestamp: string;
  message_type?: string;
  media_data?: string | null;
  /** DB column: WhatsApp rows use contact phone as sender_id for both inbound and outbound. */
  is_sent_by_me?: boolean | null;
  is_read?: boolean | null;
}

const CONVERSATION_ACTION_COUNTS_STORAGE_KEY = "conversation_action_counts_v1";
const CONVERSATION_ACTION_STALE_MS = 2 * 60 * 1000;

type ConversationActionPersisted = {
  count: number;
  updatedAt: number;
};

function readPersistedIndicatorStatus(metadata: unknown): "success" | "error" | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const ui = (metadata as Record<string, unknown>).ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return null;
  const actionIndicator = (ui as Record<string, unknown>).action_indicator;
  if (!actionIndicator || typeof actionIndicator !== "object" || Array.isArray(actionIndicator)) return null;
  const status = (actionIndicator as Record<string, unknown>).status;
  return status === "success" || status === "error" ? status : null;
}

/** True when server marked this contact as running a dynamic action (cross-tab spinner). */
function readDynamicActionRunning(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const ui = (metadata as Record<string, unknown>).ui;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) return false;
  const run = (ui as Record<string, unknown>).dynamic_action_running;
  if (!run || typeof run !== "object" || Array.isArray(run)) return false;
  const startedAt = (run as Record<string, unknown>).started_at;
  return typeof startedAt === "string" && startedAt.trim().length > 0;
}

/**
 * Supabase Realtime often delivers JSON/JSONB columns as parsed objects; RPC SELECT
 * usually returns strings. Normalize so the chat UI always gets a JSON string for media_data.
 */
function normalizeMessageMediaData(media_data: unknown): string | null {
  if (media_data == null) return null;
  if (typeof media_data === "string") return media_data;
  if (typeof media_data === "object") {
    try {
      return JSON.stringify(media_data);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Outgoing API/webhook rows store sender_id = contact phone and receiver_id = business user for
 * both directions; use DB is_sent_by_me when present.
 */
function isMessageFromCurrentUser(
  msg: Pick<MessagePayload, 'sender_id' | 'is_sent_by_me'>,
  currentUserId: string
): boolean {
  if (msg.is_sent_by_me !== undefined && msg.is_sent_by_me !== null) {
    return Boolean(msg.is_sent_by_me);
  }
  return msg.sender_id === currentUserId;
}

/** Compare contact keys when one side may include +, spaces, or @suffix noise. */
function sameConversationContactId(a: string, b: string): boolean {
  const d = (s: string) => s.replace(/\D/g, "");
  return d(a) === d(b) && d(a).length > 0;
}

/**
 * Whether a messages row belongs to the open 1:1 thread with `contactId`.
 * Supports canonical rows (contact → owner) and legacy rows (owner → contact).
 */
function messageBelongsToContactThread(
  row: Pick<MessagePayload, "sender_id" | "receiver_id">,
  ownerId: string,
  contactId: string,
): boolean {
  return (
    (row.receiver_id === ownerId &&
      sameConversationContactId(row.sender_id, contactId)) ||
    (row.sender_id === ownerId &&
      sameConversationContactId(row.receiver_id, contactId))
  );
}

interface UnreadConversation {
  conversation_id: string;
  display_name: string;
  unread_count: number;
  last_message_time: string;
}

function normalizeStatusRuleMode(raw: unknown): "ai" | "hard" | null {
  if (raw === "hard") return "hard";
  if (raw === "ai") return "ai";
  return null;
}

export default function ChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ChatUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null);
  const [checkingSetup, setCheckingSetup] = useState(true);
  /** Shown when setup is incomplete — drives accurate copy for Meta vs Green API. */
  const [setupProviderHint, setSetupProviderHint] = useState<
    'whatsapp_cloud' | 'green_api'
  >('whatsapp_cloud');
  /** Active messaging provider for chat actions (reply / reaction). */
  const [messagingProvider, setMessagingProvider] = useState<
    'whatsapp_cloud' | 'green_api' | null
  >(null);
  const [providerPhoneNumber, setProviderPhoneNumber] = useState<string | null>(null);
  /**
   * Ref-count of in-flight work per conversation (send, reaction, dynamic action).
   * Spinner visibility is derived — see `conversationLoadingById` below.
   */
  const [conversationActionCounts, setConversationActionCounts] = useState<Record<string, number>>({});
  /** After a dynamic action finishes (not while viewing that chat), show check / fail in the list until the user opens the thread. */
  const [conversationActionResultById, setConversationActionResultById] = useState<
    Record<string, "success" | "error">
  >({});
  /** Spinner driven by `contacts.metadata.ui.dynamic_action_running` (other tabs / browsers). */
  const [conversationRemoteActionSpinnerById, setConversationRemoteActionSpinnerById] = useState<
    Record<string, boolean>
  >({});
  const [broadcastGroupId, setBroadcastGroupId] = useState<string | null>(null);
  const [broadcastGroupName, setBroadcastGroupName] = useState<string | null>(null);
  /** 1:1 thread: fetching messages from RPC (false when showing cached prefetch). */
  const [threadLoading, setThreadLoading] = useState(false);
  /**
   * Synchronous guard against duplicate sends in the same event loop tick.
   * State updates are async, so this closes the short reentrancy window.
   */
  const sendingMessageRef = useRef(false);
  const supabase = createClient();
  const avatarBackfillAttemptedRef = useState(() => new Set<string>())[0];
  const avatarBackfillTriggeredRef = useRef(false);
  /** Recent conversation payloads — hover prefetch + instant reopen. */
  const messagesCacheRef = useRef(
    new Map<string, { messages: Message[]; at: number }>(),
  );
  const CACHE_TTL_MS = 90_000;
  const usersRef = useRef<ChatUser[]>([]);
  const selectedUserRef = useRef<ChatUser | null>(null);
  const broadcastGroupIdRef = useRef<string | null>(null);
  const fetchUsersRef = useRef<(() => Promise<void>) | null>(null);
  const conversationActionCountsRef = useRef<Record<string, number>>({});
  const conversationRemoteActionSpinnerRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    conversationActionCountsRef.current = conversationActionCounts;
  }, [conversationActionCounts]);

  useEffect(() => {
    conversationRemoteActionSpinnerRef.current = conversationRemoteActionSpinnerById;
  }, [conversationRemoteActionSpinnerById]);

  /** Local ref-counts OR server `dynamic_action_running` (other clients). */
  const conversationLoadingById = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const [id, count] of Object.entries(conversationActionCounts)) {
      if ((count ?? 0) > 0) out[id] = true;
    }
    for (const [id, on] of Object.entries(conversationRemoteActionSpinnerById)) {
      if (on) out[id] = true;
    }
    return out;
  }, [conversationActionCounts, conversationRemoteActionSpinnerById]);

  const hasPendingActionSpinner = useMemo(
    () =>
      Object.values(conversationActionCounts).some((c) => c > 0) ||
      Object.values(conversationRemoteActionSpinnerById).some(Boolean),
    [conversationActionCounts, conversationRemoteActionSpinnerById],
  );

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(CONVERSATION_ACTION_COUNTS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, ConversationActionPersisted>;
      const now = Date.now();
      const restored: Record<string, number> = {};
      for (const [contactId, value] of Object.entries(parsed)) {
        if (!value || typeof value.count !== "number" || typeof value.updatedAt !== "number") continue;
        if (value.count <= 0) continue;
        if (now - value.updatedAt > CONVERSATION_ACTION_STALE_MS) continue;
        restored[contactId] = value.count;
      }
      if (Object.keys(restored).length > 0) {
        setConversationActionCounts(restored);
      }
    } catch {
      // ignore malformed persisted UI state
    }
  }, []);

  useEffect(() => {
    let previousPersisted: Record<string, ConversationActionPersisted> = {};
    try {
      const raw = window.sessionStorage.getItem(CONVERSATION_ACTION_COUNTS_STORAGE_KEY);
      if (raw) {
        previousPersisted = JSON.parse(raw) as Record<string, ConversationActionPersisted>;
      }
    } catch {
      previousPersisted = {};
    }
    const now = Date.now();
    const toPersist: Record<string, ConversationActionPersisted> = {};
    for (const [contactId, count] of Object.entries(conversationActionCounts)) {
      if (count > 0) {
        const previousUpdatedAt = previousPersisted[contactId]?.updatedAt;
        toPersist[contactId] = {
          count,
          // Keep original timestamp so refresh doesn't endlessly extend spinner lifetime.
          updatedAt: typeof previousUpdatedAt === "number" ? previousUpdatedAt : now,
        };
      }
    }
    if (Object.keys(toPersist).length === 0) {
      window.sessionStorage.removeItem(CONVERSATION_ACTION_COUNTS_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(CONVERSATION_ACTION_COUNTS_STORAGE_KEY, JSON.stringify(toPersist));
  }, [conversationActionCounts]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setConversationActionCounts((prev) => {
        let changed = false;
        const next: Record<string, number> = {};
        for (const [contactId, count] of Object.entries(prev)) {
          if (count <= 0) {
            changed = true;
            continue;
          }
          const raw = window.sessionStorage.getItem(CONVERSATION_ACTION_COUNTS_STORAGE_KEY);
          let updatedAt = now;
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as Record<string, ConversationActionPersisted>;
              const saved = parsed[contactId];
              if (saved && typeof saved.updatedAt === "number") {
                updatedAt = saved.updatedAt;
              }
            } catch {
              // ignore parse errors
            }
          }
          if (now - updatedAt > CONVERSATION_ACTION_STALE_MS) {
            changed = true;
            continue;
          }
          next[contactId] = count;
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    broadcastGroupIdRef.current = broadcastGroupId;
  }, [broadcastGroupId]);

  /** When an action finishes on the server (metadata.ui.action_indicator) or is cleared, sync list UI without manual refresh. */
  useEffect(() => {
    if (!user?.id) return;
    const client = createClient();

    const applyContactActionUiFromPayload = (payload: {
      old?: Record<string, unknown> | null;
      new?: Record<string, unknown> | null;
    }) => {
      const row = (payload.new ?? {}) as { phone?: unknown; metadata?: unknown };
      const phone = String(row.phone ?? "").trim();
      if (!phone) return;

      const oldMeta =
        payload.old && typeof payload.old === "object"
          ? (payload.old as { metadata?: unknown }).metadata
          : undefined;
      const newStatus = readPersistedIndicatorStatus(row.metadata);
      const oldStatus = readPersistedIndicatorStatus(oldMeta);
      const newRun = readDynamicActionRunning(row.metadata);
      const oldRun = readDynamicActionRunning(oldMeta);
      if (newStatus === oldStatus && newRun === oldRun) return;

      const listIds = new Set<string>();
      for (const u of usersRef.current) {
        if (sameConversationContactId(u.id, phone)) listIds.add(u.id);
      }
      listIds.add(phone);

      if (newRun !== oldRun) {
        setConversationRemoteActionSpinnerById((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const id of listIds) {
            if (newRun) {
              if (next[id] !== true) {
                next[id] = true;
                changed = true;
              }
            } else if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }

      if (newStatus === oldStatus) return;

      setConversationActionCounts((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (sameConversationContactId(key, phone)) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      setConversationActionResultById((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of listIds) {
          if (newStatus) {
            if (next[id] !== newStatus) {
              next[id] = newStatus;
              changed = true;
            }
          } else if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const channel = client
      .channel(`contacts-action-ui-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "contacts",
          filter: `owner_id=eq.${user.id}`,
        },
        (payload) => {
          applyContactActionUiFromPayload({
            old: payload.old as Record<string, unknown> | null,
            new: payload.new as Record<string, unknown> | null,
          });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user?.id]);

  /** Poll DB while any row shows the action spinner — fixes missed Realtime + refresh-mid-action. */
  useEffect(() => {
    if (!user?.id || !hasPendingActionSpinner) return;
    const client = createClient();
    const ownerId = user.id;

    const poll = async () => {
      const snap = conversationActionCountsRef.current;
      const remoteSnap = conversationRemoteActionSpinnerRef.current;
      const pendingKeys = [
        ...new Set([
          ...Object.keys(snap).filter((k) => (snap[k] ?? 0) > 0),
          ...Object.keys(remoteSnap).filter((k) => remoteSnap[k]),
        ]),
      ];
      if (pendingKeys.length === 0) return;

      const phoneCandidates = new Set<string>();
      for (const k of pendingKeys) {
        phoneCandidates.add(k);
        const d = k.replace(/\D/g, "");
        if (d) phoneCandidates.add(d);
      }
      const list = [...phoneCandidates].slice(0, 80);
      if (list.length === 0) return;

      const { data: rows, error } = await client
        .from("contacts")
        .select("phone, metadata")
        .eq("owner_id", ownerId)
        .in("phone", list);

      if (error || !rows?.length) return;

      setConversationRemoteActionSpinnerById((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const row of rows) {
          const phone = String((row as { phone?: unknown }).phone ?? "").trim();
          if (!phone) continue;
          const running = readDynamicActionRunning((row as { metadata?: unknown }).metadata);
          const ids = new Set<string>(
            usersRef.current.map((x) => x.id).filter((id) => sameConversationContactId(id, phone)),
          );
          ids.add(phone);
          for (const id of ids) {
            if (running) {
              if (next[id] !== true) {
                next[id] = true;
                changed = true;
              }
            } else if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });

      const updates: { phone: string; status: "success" | "error" }[] = [];
      for (const row of rows) {
        const phone = String((row as { phone?: unknown }).phone ?? "").trim();
        if (!phone) continue;
        const status = readPersistedIndicatorStatus((row as { metadata?: unknown }).metadata);
        if (!status) continue;
        if (!pendingKeys.some((k) => sameConversationContactId(k, phone))) continue;
        updates.push({ phone, status });
      }
      if (updates.length === 0) return;

      setConversationActionCounts((prev) => {
        let next = { ...prev };
        let changed = false;
        for (const u of updates) {
          for (const key of Object.keys(next)) {
            if (sameConversationContactId(key, u.phone)) {
              delete next[key];
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });

      setConversationActionResultById((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const u of updates) {
          const ids = new Set<string>(
            usersRef.current.map((x) => x.id).filter((id) => sameConversationContactId(id, u.phone)),
          );
          ids.add(u.phone);
          for (const id of ids) {
            if (next[id] !== u.status) {
              next[id] = u.status;
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [user?.id, hasPendingActionSpinner]);

  const mapMessageRows = useCallback(
    (rows: unknown[]): Message[] => {
      if (!user) return [];
      return (rows as (MessagePayload & { message_timestamp?: string })[]).map(
        (msg) => ({
          ...msg,
          media_data: normalizeMessageMediaData(msg.media_data),
          timestamp: msg.message_timestamp || msg.timestamp,
          is_sent_by_me: isMessageFromCurrentUser(msg, user.id),
        }),
      ) as Message[];
    },
    [user],
  );

  // Define handleBackToUsers early so it can be used in useEffect
  const handleBackToUsers = useCallback(() => {
    setShowChat(false);
    setSelectedUser(null);
    setMessages([]);
  }, []);

  // Check screen size for responsive behavior
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Handle ESC key press to close chat window
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isMobile && showChat) {
          // On mobile, go back to user list
          handleBackToUsers();
        } else if (!isMobile && selectedUser) {
          // On desktop, close chat window
          setSelectedUser(null);
          setMessages([]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, showChat, selectedUser, handleBackToUsers]);

  // Get current user and check setup
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        // Check if user has completed setup
        const response = await fetch('/api/settings/save');
        const data = await response.json();
        
        const provider = data.settings?.messaging_provider || 'whatsapp_cloud';
        setSetupProviderHint(provider === 'green_api' ? 'green_api' : 'whatsapp_cloud');
        setMessagingProvider(provider === 'green_api' ? 'green_api' : 'whatsapp_cloud');
        setProviderPhoneNumber(data.settings?.provider_phone_number ?? null);
        const hasCommonPhone = !!data.settings?.provider_phone_number;
        const greenReady = !!(
          data.settings?.green_api_url &&
          data.settings?.green_id_instance &&
          data.settings?.green_api_token_instance
        );
        const whatsappReady = !!(data.settings?.access_token_added || data.settings?.webhook_verified);
        const setupComplete =
          provider === 'green_api'
            ? greenReady && hasCommonPhone
            : whatsappReady && hasCommonPhone;
        setIsSetupComplete(setupComplete);
        setCheckingSetup(false);
      }
    };
    getUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Subscribe to users table for real-time updates with optimized loading
  useEffect(() => {
    if (!user) return;

    let isInitialLoad = true;

    const fetchUsers = async () => {
      console.log('Fetching user conversations...');
      
      // Use owner-scoped contact_conversations view
      const { data, error } = await supabase
        .from('contact_conversations')
        .select('*')
        .order('has_unread', { ascending: false })
        .order('last_message_time', { ascending: false });
      
      if (error) {
        console.error('Error fetching users:', error);
        return;
      }

      if (data) {
        console.log(`Fetched ${data.length} user conversations`);
        try {
          const sample = (data as Array<Record<string, unknown>>).slice(0, 10);
          const withAvatar = sample.filter((r) => !!r?.avatar_url).length;
          const keys = Object.keys(sample[0] || {});
          console.log("[avatars] contact_conversations keys:", keys);
          console.log(
            `[avatars] sample size=${sample.length}, withAvatar=${withAvatar}`,
            sample.map((r) => ({
              id: r.id,
              display_name: r.display_name,
              avatar_url: r.avatar_url,
            })),
          );
        } catch (e) {
          console.warn("[avatars] debug log failed:", e);
        }

        // Green API avatar backfill (best-effort): call once on initial page open only.
        try {
          if (!avatarBackfillTriggeredRef.current) {
            avatarBackfillTriggeredRef.current = true;
            const rows = data as Array<{ id?: string; avatar_url?: string | null }>;
            const missing = rows
              .map((r) => String(r.id ?? ""))
              .filter(Boolean)
              .filter((id) => !avatarBackfillAttemptedRef.has(id))
              .filter((id) => {
                const row = rows.find((x) => String(x.id ?? "") === id);
                return !row?.avatar_url;
              })
              .slice(0, 25);

            if (missing.length > 0) {
              missing.forEach((id) => avatarBackfillAttemptedRef.add(id));
              console.log("[avatars] attempting Green avatar backfill once for:", missing);
              fetch("/api/contacts/refresh-avatars", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contactIds: missing }),
              })
                .then((r) => r.json().catch(() => null))
                .then((res) => {
                  console.log("[avatars] backfill result:", res);
                  // refresh users list so avatar_url appears
                  setTimeout(fetchUsers, 1200);
                })
                .catch((e) => console.warn("[avatars] backfill call failed:", e));
            }
          }
        } catch (e) {
          console.warn("[avatars] backfill scheduling failed:", e);
        }
        
        // Transform data to match ChatUser interface
        const transformedUsers: ChatUser[] = data.map(user => ({
          id: user.id,
          name: user.display_name, // This now uses the priority logic from the view
          custom_name: user.custom_name,
          whatsapp_name: user.whatsapp_name,
          avatar_url: user.avatar_url ?? null,
          last_active: user.last_active,
          unread_count: user.unread_count || 0,
          last_message_time: user.last_message_time,
          last_message: user.last_message,
          last_message_type: user.last_message_type,
          last_message_sender: user.last_message_sender,
          status_id: user.status_id ?? null,
          status_name: user.status_name ?? null,
          status_color: user.status_color ?? null,
          status_rule: user.status_rule ?? null,
          status_rule_mode: normalizeStatusRuleMode(
            (user as { status_rule_mode?: unknown }).status_rule_mode,
          ),
          auto_translate_enabled:
            (user as { auto_translate_enabled?: unknown }).auto_translate_enabled === true,
        }));

        setUsers(transformedUsers);

        try {
          const ids = transformedUsers.map((u) => u.id).filter(Boolean);
          if (ids.length === 0) {
            setConversationActionResultById({});
            setConversationRemoteActionSpinnerById({});
          } else {
            const { data: contactsRows, error: contactsError } = await supabase
              .from("contacts")
              .select("phone, metadata")
              .eq("owner_id", user.id)
              .in("phone", ids);
            if (contactsError) {
              console.error("Error fetching persisted action indicators:", contactsError);
            } else {
              const persisted: Record<string, "success" | "error"> = {};
              for (const row of contactsRows ?? []) {
                const phone = String((row as { phone?: unknown }).phone ?? "");
                const status = readPersistedIndicatorStatus((row as { metadata?: unknown }).metadata);
                if (phone && status) persisted[phone] = status;
              }
              setConversationActionResultById((prev) => ({ ...prev, ...persisted }));
              // Session-restore can leave a spinner while DB already shows completion — clear counts.
              if (Object.keys(persisted).length > 0) {
                setConversationActionCounts((prev) => {
                  let changed = false;
                  const next = { ...prev };
                  for (const countKey of Object.keys(next)) {
                    for (const phone of Object.keys(persisted)) {
                      if (sameConversationContactId(countKey, phone)) {
                        delete next[countKey];
                        changed = true;
                        break;
                      }
                    }
                  }
                  return changed ? next : prev;
                });
              }
              setConversationRemoteActionSpinnerById((prev) => {
                const next = { ...prev };
                let changed = false;
                for (const u of transformedUsers) {
                  const row = (contactsRows ?? []).find((r) =>
                    sameConversationContactId(
                      String((r as { phone?: unknown }).phone ?? ""),
                      u.id,
                    ),
                  );
                  const running = row
                    ? readDynamicActionRunning((row as { metadata?: unknown }).metadata)
                    : false;
                  if (running) {
                    if (next[u.id] !== true) {
                      next[u.id] = true;
                      changed = true;
                    }
                  } else if (next[u.id]) {
                    delete next[u.id];
                    changed = true;
                  }
                }
                return changed ? next : prev;
              });
            }
          }
        } catch (e) {
          console.error("Failed to sync persisted action indicators:", e);
        }

        // On initial load, preload top 10 unread conversations
        if (isInitialLoad) {
          isInitialLoad = false;
          preloadUnreadConversations();
        }
      }
    };

    fetchUsersRef.current = fetchUsers;

    const preloadUnreadConversations = async () => {
      try {
        console.log('Preloading unread conversations...');
        
        // Get top 10 unread conversations
        const { data: unreadConversations, error } = await supabase.rpc('get_unread_conversations', {
          limit_count: 10
        });

        if (error) {
          console.error('Error preloading unread conversations:', error);
          return;
        }

        if (unreadConversations && unreadConversations.length > 0) {
          console.log(`Preloading messages for ${unreadConversations.length} unread conversations`);
          
          // Preload messages for each unread conversation (in parallel)
          const preloadPromises = unreadConversations.map(async (conversation: UnreadConversation) => {
            try {
              const { data: messages, error: messagesError } = await supabase.rpc('get_conversation_messages', {
                other_user_id: conversation.conversation_id
              });

              if (messagesError) {
                console.error(`Error preloading messages for ${conversation.conversation_id}:`, messagesError);
              } else {
                console.log(`Preloaded ${messages?.length || 0} messages for ${conversation.display_name}`);
                // Store in a cache if needed (optional - for now just log)
              }
            } catch (error) {
              console.error(`Error in preload for ${conversation.conversation_id}:`, error);
            }
          });

          // Wait for all preload operations to complete
          await Promise.allSettled(preloadPromises);
          console.log('Preloading completed');
        }
      } catch (error) {
        console.error('Error in preloadUnreadConversations:', error);
      }
    };

    // Initial fetch
    fetchUsers();

    // Set up real-time subscription for users table changes
    const usersSubscription = supabase
      .channel('users-channel-optimized')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'users' 
      }, (payload) => {
        console.log('Users table change:', payload.eventType);
        // Debounce the refresh to avoid excessive calls
        setTimeout(fetchUsers, 100);
      })
      .subscribe();

    let messagesFetchDebounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleMessagesListRefresh = () => {
      if (messagesFetchDebounce) clearTimeout(messagesFetchDebounce);
      messagesFetchDebounce = setTimeout(() => {
        messagesFetchDebounce = null;
        void fetchUsers();
      }, 600);
    };

    // Set up real-time subscription for messages table changes
    const messagesSubscription = supabase
      .channel('messages-global-channel-optimized')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'messages' 
      }, (payload) => {
        console.log('Messages table change:', payload.eventType);
        
        const message = payload.new as MessagePayload | null;
        const oldRow = payload.old as MessagePayload | null;
        const ownerId = user?.id ?? '';
        const effective =
          message?.sender_id && message?.receiver_id
            ? message
            : oldRow?.sender_id && oldRow?.receiver_id
              ? oldRow
              : null;

        if (effective && ownerId) {
          const otherUserId =
            effective.sender_id === ownerId
              ? effective.receiver_id
              : effective.sender_id;

          const viewingId = selectedUserRef.current?.id ?? null;
          const isCurrentlyViewing =
            viewingId != null &&
            sameConversationContactId(viewingId, otherUserId);

          const listSnapshot = usersRef.current;
          const hadConversation = listSnapshot.some((u) =>
            sameConversationContactId(u.id, otherUserId),
          );

          if (payload.eventType === 'INSERT' && !hadConversation) {
            void fetchUsers();
          }

          if (message) {
            setUsers((prevUsers) => {
              const updatedUsers = prevUsers.map((u) => {
                if (!sameConversationContactId(u.id, otherUserId)) return u;

                const isFromMe = isMessageFromCurrentUser(message, ownerId);
                const shouldIncrementUnread =
                  !isFromMe && !isCurrentlyViewing;

                return {
                  ...u,
                  last_message: message.content || '',
                  last_message_time: message.timestamp,
                  last_message_type: message.message_type || 'text',
                  last_message_sender: isFromMe ? ownerId : message.sender_id,
                  unread_count: shouldIncrementUnread
                    ? (u.unread_count || 0) + 1
                    : u.unread_count,
                };
              });

              return updatedUsers.sort((a, b) => {
                if ((a.unread_count || 0) > 0 && (b.unread_count || 0) === 0)
                  return -1;
                if ((a.unread_count || 0) === 0 && (b.unread_count || 0) > 0)
                  return 1;
                const aTime = new Date(
                  a.last_message_time || a.last_active,
                ).getTime();
                const bTime = new Date(
                  b.last_message_time || b.last_active,
                ).getTime();
                return bTime - aTime;
              });
            });
          }
        }

        scheduleMessagesListRefresh();
      })
      .subscribe();

    return () => {
      if (messagesFetchDebounce) clearTimeout(messagesFetchDebounce);
      usersSubscription.unsubscribe();
      messagesSubscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // supabase and selectedUser are stable/controlled

  // Subscribe to messages for selected user with improved real-time handling
  useEffect(() => {
    if (!selectedUser || !user) {
      setMessages([]);
      setThreadLoading(false);
      return;
    }

    let cancelled = false;
    const contactId = selectedUser.id;
    /** Realtime callbacks can fire after switching chats; ignore them if we're no longer on this thread. */
    const isStaleMessagesRealtimeHandler = () => {
      const v = selectedUserRef.current;
      return !v || !sameConversationContactId(v.id, contactId);
    };

    const cached = messagesCacheRef.current.get(contactId);
    const cacheFresh = !!(cached && Date.now() - cached.at < CACHE_TTL_MS);

    if (cacheFresh && cached) {
      setMessages(cached.messages);
      setThreadLoading(false);
    } else {
      setMessages([]);
      setThreadLoading(true);
    }

    const loadMessages = async () => {
      const { data, error } = await supabase.rpc("get_conversation_messages", {
        other_user_id: contactId,
      });

      if (cancelled) return;

      if (error) {
        console.error("Error fetching messages:", error);
        if (!cacheFresh) {
          setMessages([]);
        }
      } else {
        const mappedMessages = mapMessageRows(data || []);
        setMessages(mappedMessages);
        messagesCacheRef.current.set(contactId, {
          messages: mappedMessages,
          at: Date.now(),
        });
      }
      setThreadLoading(false);
    };

    void loadMessages();

    // Set up real-time subscription for messages with a unique channel name
    const channelName = `messages-${user.id}-${selectedUser.id}-${Date.now()}`;
    const messagesSubscription = supabase
      .channel(channelName)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages'
      }, (payload) => {
        if (isStaleMessagesRealtimeHandler()) return;
        const newMessage = payload.new as MessagePayload;

        const isRelevantMessage = messageBelongsToContactThread(
          newMessage,
          user.id,
          contactId,
        );

        if (isRelevantMessage) {
          const sentByMe = isMessageFromCurrentUser(newMessage, user.id);
          const messageWithFlag: Message = {
            ...newMessage,
            media_data: normalizeMessageMediaData(newMessage.media_data),
            is_sent_by_me: sentByMe,
            timestamp: newMessage.timestamp || new Date().toISOString()
          };

          setMessages((prev) => {
            // Avoid duplicates (same WhatsApp id, or replace optimistic same content / outbound)
            const exists = prev.find(m =>
              m.id === messageWithFlag.id ||
              (m.id.startsWith('optimistic_') &&
                m.is_sent_by_me &&
                messageWithFlag.is_sent_by_me &&
                m.content === messageWithFlag.content)
            );
            
            if (exists) {
              // Replace optimistic message with real one
              if (exists.id.startsWith('optimistic_')) {
                return prev.map(m => m.id === exists.id ? messageWithFlag : m);
              }
              return prev;
            }
            
            // Insert message in correct chronological order
            const newMessages = [...prev, messageWithFlag];
            return newMessages.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          });

          // Mark message as read if we received it (not an outbound row)
          if (!messageWithFlag.is_sent_by_me) {
            setTimeout(() => {
              if (isStaleMessagesRealtimeHandler()) return;
              fetch('/api/messages/mark-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otherUserId: contactId }),
              }).catch(console.error);
            }, 500);
          }
        }
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'messages'
      }, (payload) => {
        if (isStaleMessagesRealtimeHandler()) return;
        const updatedMessage = payload.new as MessagePayload;

        const isRelevantMessage = messageBelongsToContactThread(
          updatedMessage,
          user.id,
          contactId,
        );

        if (isRelevantMessage) {
          const messageWithFlag: Message = {
            ...updatedMessage,
            media_data: normalizeMessageMediaData(updatedMessage.media_data),
            is_sent_by_me: isMessageFromCurrentUser(updatedMessage, user.id),
            timestamp: updatedMessage.timestamp || new Date().toISOString()
          };
          
          setMessages((prev) => 
            prev.map(m => m.id === updatedMessage.id ? messageWithFlag : m)
          );
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        if (isStaleMessagesRealtimeHandler()) return;
        const oldRow = payload.old as { id?: string } | null;
        const deletedId = oldRow?.id;
        if (!deletedId) return;
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
      })
      .subscribe();

    return () => {
      cancelled = true;
      messagesSubscription.unsubscribe();
    };
  }, [selectedUser, user, supabase, mapMessageRows]);

  // After tab sleep / reconnect, resync sidebar + open thread (Realtime can miss events while hidden).
  useEffect(() => {
    if (!user) return;

    const syncAfterResume = () => {
      if (document.visibilityState !== "visible") return;
      void fetchUsersRef.current?.();
      const sel = selectedUserRef.current;
      if (!sel || broadcastGroupIdRef.current) return;
      void (async () => {
        const { data, error } = await supabase.rpc("get_conversation_messages", {
          other_user_id: sel.id,
        });
        if (error) {
          console.error("Resume sync: conversation messages", error);
          return;
        }
        const mapped = mapMessageRows(data || []);
        setMessages(mapped);
        messagesCacheRef.current.set(sel.id, {
          messages: mapped,
          at: Date.now(),
        });
      })();
    };

    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) syncAfterResume();
    };

    document.addEventListener("visibilitychange", syncAfterResume);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", syncAfterResume);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [user, supabase, mapMessageRows]);

  // Fetch broadcast messages when broadcast group is selected
  useEffect(() => {
    if (!broadcastGroupId || !user) {
      // Clear messages if no broadcast group is selected
      if (!selectedUser) {
        setMessages([]);
      }
      return;
    }

    const fetchBroadcastMessages = async () => {
      console.log(`Fetching broadcast messages for group ${broadcastGroupId}`);
      
      try {
        const response = await fetch(`/api/groups/${broadcastGroupId}/messages`);
        const result = await response.json();
        
        if (response.ok && result.success) {
          console.log(`Fetched ${result.messages?.length || 0} broadcast messages`);
          setMessages(result.messages || []);
        } else {
          console.error('Failed to fetch broadcast messages:', result.error);
          setMessages([]);
        }
      } catch (error) {
        console.error('Error fetching broadcast messages:', error);
        setMessages([]);
      }
    };

    fetchBroadcastMessages();

    // Set up real-time subscription for broadcast messages
    const channelName = `broadcast-${broadcastGroupId}-${Date.now()}`;
    const messagesSubscription = supabase
      .channel(channelName)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages'
      }, (payload) => {
        console.log('New broadcast message received via real-time:', payload);
        
        const newMessage = payload.new as MessagePayload;
        
        // Check if this message belongs to the current broadcast group
        try {
          const mediaData = typeof newMessage.media_data === 'string'
            ? JSON.parse(newMessage.media_data)
            : newMessage.media_data;
          
          if (mediaData?.broadcast_group_id === broadcastGroupId) {
            console.log('Adding broadcast message to window');
            
            const messageWithFlag = {
              ...newMessage,
              media_data: normalizeMessageMediaData(newMessage.media_data),
              is_sent_by_me: true,
              timestamp: newMessage.timestamp || new Date().toISOString()
            };
            
            setMessages((prev) => {
              // Avoid duplicates
              const exists = prev.find(m => m.id === messageWithFlag.id);
              if (exists) return prev;
              
              // Add message and sort by timestamp
              return [...prev, messageWithFlag].sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );
            });
          }
        } catch (error) {
          console.error('Error parsing broadcast message:', error);
        }
      })
      .subscribe();

    console.log(`Subscribed to broadcast messages channel: ${channelName}`);

    return () => {
      console.log(`Unsubscribing from broadcast messages channel: ${channelName}`);
      messagesSubscription.unsubscribe();
    };
  }, [broadcastGroupId, user, supabase, selectedUser]);

  // Handle user selection — keep this synchronous so the UI switches immediately (no await before paint).
  const handleUserSelect = (next: ChatUser) => {
    setBroadcastGroupId(null);
    setBroadcastGroupName(null);
    setSelectedUser(next);
    setShowChat(true);
    setConversationRemoteActionSpinnerById((prev) => {
      let changed = false;
      const out = { ...prev };
      for (const k of Object.keys(out)) {
        if (sameConversationContactId(k, next.id)) {
          delete out[k];
          changed = true;
        }
      }
      return changed ? out : prev;
    });
    setConversationActionResultById((prev) => {
      if (!(next.id in prev)) return prev;
      const rest = { ...prev };
      delete rest[next.id];
      return rest;
    });
    void fetch("/api/conversations/action-indicator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: next.id, status: null }),
    }).catch(() => undefined);

    const prevUnread = next.unread_count ?? 0;
    if (prevUnread > 0) {
      setUsers((u) =>
        u.map((row) =>
          row.id === next.id ? { ...row, unread_count: 0 } : row,
        ),
      );
      void fetch("/api/messages/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherUserId: next.id }),
      })
        .then((res) => {
          if (!res.ok) {
            setUsers((u) =>
              u.map((row) =>
                row.id === next.id ? { ...row, unread_count: prevUnread } : row,
              ),
            );
          }
        })
        .catch(() => {
          setUsers((u) =>
            u.map((row) =>
              row.id === next.id ? { ...row, unread_count: prevUnread } : row,
            ),
          );
        });
    }
  };

  const refreshUsers = useCallback(async () => {
    if (!user) return;
    
    console.log('Refreshing user conversations...');
    
    const { data, error } = await supabase
      .from('contact_conversations')
      .select('*')
      .order('has_unread', { ascending: false })
      .order('last_message_time', { ascending: false });
    
    if (error) {
      console.error('Error refreshing users:', error);
      return;
    }

    if (data) {
      const transformedUsers: ChatUser[] = data.map(user => ({
        id: user.id,
        name: user.display_name,
        custom_name: user.custom_name,
        whatsapp_name: user.whatsapp_name,
        avatar_url: user.avatar_url ?? null,
        last_active: user.last_active,
        unread_count: user.unread_count || 0,
        last_message_time: user.last_message_time,
        last_message: user.last_message,
        last_message_type: user.last_message_type,
        last_message_sender: user.last_message_sender,
        status_id: user.status_id ?? null,
        status_name: user.status_name ?? null,
        status_color: user.status_color ?? null,
        status_rule: user.status_rule ?? null,
        status_rule_mode: normalizeStatusRuleMode(
          (user as { status_rule_mode?: unknown }).status_rule_mode,
        ),
        auto_translate_enabled:
          (user as { auto_translate_enabled?: unknown }).auto_translate_enabled === true,
      }));

      setUsers(transformedUsers);
      console.log(`Refreshed ${transformedUsers.length} user conversations`);
    }
  }, [user, supabase]);

  const handleUpdateName = useCallback(async (userId: string, customName: string) => {
    try {
      const response = await fetch('/api/users/update-name', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          customName: customName.trim() || null
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || 'Failed to update name');
      }

      console.log('Name updated successfully:', result);
      
      // Refresh users list to show updated name
      await refreshUsers();

    } catch (error) {
      console.error('Error updating name:', error);
      throw error; // Re-throw to let the dialog handle the error
    }
  }, [refreshUsers]);

  const handleBroadcastToGroup = useCallback((groupId: string, groupName: string) => {
    console.log('Broadcasting to group:', groupName);
    
    // Clear individual user state
    setSelectedUser(null);
    setMessages([]);
    
    // Set broadcast group state
    setBroadcastGroupId(groupId);
    setBroadcastGroupName(groupName);
    
    // Show chat window on mobile
    setShowChat(true);
  }, []);

  const handleSendBroadcast = async (content: string) => {
    if (!broadcastGroupId || !user || sendingMessage) return;

    setSendingMessage(true);
    
    // Generate optimistic message ID
    const optimisticId = `optimistic_broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    // Check if content is a template (JSON format)
    let requestBody;
    let messageContent = content;
    let messageType = 'text';
    let isTemplate = false;
    
    try {
      const parsedContent = JSON.parse(content);
      if (parsedContent.type === 'template') {
        // Template broadcast
        isTemplate = true;
        messageContent = parsedContent.displayMessage;
        messageType = 'template';
        requestBody = {
          message: parsedContent.displayMessage,
          messageType: 'template',
          templateName: parsedContent.templateName,
          templateData: parsedContent.templateData,
          variables: parsedContent.variables,
        };
      } else {
        requestBody = {
          message: content,
          messageType: 'text',
        };
      }
    } catch {
      // Not JSON, treat as regular text message
      requestBody = {
        message: content,
        messageType: 'text',
      };
    }
    
    // Create optimistic message for instant UI feedback
    const optimisticMessage: Message = {
      id: optimisticId,
      sender_id: user.id,
      receiver_id: user.id,
      content: messageContent,
      timestamp,
      is_sent_by_me: true,
      message_type: messageType,
      media_data: isTemplate ? content : JSON.stringify({ broadcast_group_id: broadcastGroupId })
    };
    
    // Add optimistic message to UI immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    
    try {
      console.log(`Broadcasting message to group ${broadcastGroupId}`);
      
      const response = await fetch(`/api/groups/${broadcastGroupId}/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send broadcast');
      }

      console.log('Broadcast sent successfully:', result);
      
      // Remove optimistic message and refresh to get real messages
      setMessages((prev) => prev.filter(m => m.id !== optimisticId));
      
      // Refresh broadcast messages to show the real ones
      const messagesResponse = await fetch(`/api/groups/${broadcastGroupId}/messages`);
      const messagesResult = await messagesResponse.json();
      if (messagesResponse.ok && messagesResult.success) {
        setMessages(messagesResult.messages || []);
      }
      
      // Show success message
      alert(`Broadcast sent to ${result.results.success}/${result.results.total} members`);
      
      // Refresh users list to show the broadcast messages
      await refreshUsers();
      
    } catch (error) {
      console.error('Error sending broadcast:', error);
      
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(m => m.id !== optimisticId));
      
      alert(`Failed to send broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSendMessage = async (
    content: string,
    options?: {
      quotedMessageId?: string;
      originalMessage?: string;
      autoTranslatedFrom?: string;
      autoTranslatedTo?: string;
    },
  ) => {
    // Check if we're broadcasting to a group or sending to a single user
    if (broadcastGroupId && broadcastGroupName) {
      await handleSendBroadcast(content);
      return;
    }
    
    if (!selectedUser || !user || sendingMessageRef.current || sendingMessage) return;
    const targetContactId = selectedUser.id;

    sendingMessageRef.current = true;
    setSendingMessage(true);
    setConversationActionCounts((prev) => ({
      ...prev,
      [targetContactId]: (prev[targetContactId] ?? 0) + 1,
    }));
    
    // Generate optimistic message ID
    const optimisticId = `optimistic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    // Create optimistic message for instant UI feedback
    const optimisticMessage: Message = {
      id: optimisticId,
      sender_id: user.id,
      receiver_id: selectedUser.id,
      content,
      timestamp,
      is_sent_by_me: true,
      message_type: 'text',
      media_data: options?.quotedMessageId
        ? JSON.stringify({ quoted_message_id: options.quotedMessageId })
        : null,
    };
    
    // Add optimistic message to UI immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    
    try {
      console.log(`Sending message to ${targetContactId}: ${content}`);
      
      // Call the WhatsApp API endpoint which handles both WhatsApp sending and database storage
      const response = await fetch('/api/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: targetContactId,
          message: content,
          ...(options?.originalMessage
            ? {
                originalMessage: options.originalMessage,
                autoTranslatedFrom: options.autoTranslatedFrom ?? null,
                autoTranslatedTo: options.autoTranslatedTo ?? null,
              }
            : {}),
          ...(options?.quotedMessageId
            ? { quotedMessageId: options.quotedMessageId }
            : {}),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send message');
      }

      console.log('Message sent successfully:', result);

      // Swap optimistic row for real id/timestamp so UI clears "Sending..." and realtime dedupes
      if (result.messageId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId
              ? {
                  ...m,
                  id: result.messageId as string,
                  timestamp: (result.timestamp as string) || m.timestamp,
                }
              : m
          )
        );
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove optimistic message on error
      setMessages((prev) => prev.filter(m => m.id !== optimisticId));
      
      // Show error to user
      alert(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Fallback: Store in database only if WhatsApp API fails
      try {
        const fallbackMessage = {
          sender_id: user.id,
          receiver_id: targetContactId,
          content,
          timestamp: new Date().toISOString(),
          message_type: 'text',
          media_data: options?.originalMessage
            ? JSON.stringify({
                original_text: options.originalMessage,
                translated_text: content,
                auto_translated_outgoing: true,
                ...(options.autoTranslatedFrom
                  ? { auto_translated_from: options.autoTranslatedFrom }
                  : {}),
                ...(options.autoTranslatedTo
                  ? { auto_translated_to: options.autoTranslatedTo }
                  : {}),
              })
            : null
        };

        const { error: dbError } = await supabase
          .from('messages')
          .insert([fallbackMessage]);

        if (dbError) {
          console.error('Fallback database storage also failed:', dbError);
        } else {
          console.log('Message stored in database as fallback');
        }
      } catch (fallbackError) {
        console.error('Fallback storage failed:', fallbackError);
      }
    } finally {
      sendingMessageRef.current = false;
      setSendingMessage(false);
      setConversationActionCounts((prev) => {
        const current = prev[targetContactId] ?? 0;
        if (current <= 1) {
          const next = { ...prev };
          delete next[targetContactId];
          return next;
        }
        return {
          ...prev,
          [targetContactId]: current - 1,
        };
      });
    }
  };

  const handleSendReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!selectedUser || broadcastGroupId) return;
      const targetContactId = selectedUser.id;
      setConversationActionCounts((prev) => ({
        ...prev,
        [targetContactId]: (prev[targetContactId] ?? 0) + 1,
      }));
      try {
        const response = await fetch('/api/send-reaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: targetContactId,
            messageId,
            emoji,
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof result.error === 'string'
              ? result.error
              : 'Failed to send reaction',
          );
        }
      } catch (e) {
        console.error('Send reaction:', e);
        alert(e instanceof Error ? e.message : 'Failed to send reaction');
      } finally {
        setConversationActionCounts((prev) => {
          const current = prev[targetContactId] ?? 0;
          if (current <= 1) {
            const next = { ...prev };
            delete next[targetContactId];
            return next;
          }
          return {
            ...prev,
            [targetContactId]: current - 1,
          };
        });
      }
    },
    [selectedUser, broadcastGroupId],
  );

  const handleConversationActionActivity = useCallback(
    (contactId: string, isRunning: boolean, outcome?: "success" | "error") => {
      if (!contactId) return;
      if (isRunning) {
        setConversationActionResultById((prev) => {
          if (!(contactId in prev)) return prev;
          const rest = { ...prev };
          delete rest[contactId];
          return rest;
        });
        setConversationActionCounts((prev) => ({
          ...prev,
          [contactId]: (prev[contactId] ?? 0) + 1,
        }));
        return;
      }
      setConversationActionCounts((prev) => {
        const current = prev[contactId] ?? 0;
        const nextCount = current - 1;
        let next: Record<string, number>;
        if (nextCount <= 0) {
          const rest = { ...prev };
          delete rest[contactId];
          next = rest;
        } else {
          next = { ...prev, [contactId]: nextCount };
        }
        if (nextCount <= 0 && outcome) {
          queueMicrotask(() => {
            setConversationActionResultById((r) => ({ ...r, [contactId]: outcome! }));
            void fetch("/api/conversations/action-indicator", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contactId, status: outcome }),
            }).catch(() => undefined);
          });
        }
        return next;
      });
    },
    [],
  );

  const handleStopConversationLoading = useCallback((contactId: string) => {
    if (!contactId) return;
    // Local-only escape hatch for stuck UI indicator; does not cancel server work.
    setConversationActionCounts((prev) => {
      if (!(contactId in prev)) return prev;
      const rest = { ...prev };
      delete rest[contactId];
      return rest;
    });
    setConversationRemoteActionSpinnerById((prev) => {
      let changed = false;
      const out = { ...prev };
      for (const k of Object.keys(out)) {
        if (sameConversationContactId(k, contactId)) {
          delete out[k];
          changed = true;
        }
      }
      return changed ? out : prev;
    });
    setConversationActionResultById((prev) => ({ ...prev, [contactId]: "error" }));
  }, []);

  // Show loading state while checking setup
  if (!user || checkingSetup) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }
  
  // Show setup required message if setup is not complete
  if (isSetupComplete === false) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="bg-amber-100 dark:bg-amber-900/30 p-4 rounded-full">
              <AlertCircle className="h-12 w-12 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">Setup Required</h2>
            <p className="text-muted-foreground">
              {setupProviderHint === 'green_api' ? (
                <>
                  Finish setup on the setup page: save your{' '}
                  <strong className="text-foreground font-medium">business phone number</strong>{' '}
                  and your Green API fields (apiUrl, idInstance, apiTokenInstance). The Access Token /
                  Webhook section applies to Meta only, not Green API.
                </>
              ) : (
                <>
                  Save your <strong className="text-foreground font-medium">business phone number</strong>{' '}
                  and configure the <strong className="text-foreground font-medium">Access Token</strong>{' '}
                  and/or <strong className="text-foreground font-medium">Webhook</strong> on the setup page.
                </>
              )}
            </p>
          </div>
          
          <div className="space-y-3">
            <Link href="/protected/setup">
              <Button className="w-full" size="lg">
                <Settings className="mr-2 h-5 w-5" />
                Go to Setup
              </Button>
            </Link>
            
            <p className="text-xs text-muted-foreground">
              This will only take a few minutes
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-background">
      {/* Desktop Layout */}
      {!isMobile && (
        <>
          {/* User List - Desktop */}
          <div className="w-1/3 border-r border-border">
            <UserList 
              users={users}
              selectedUser={selectedUser}
              onUserSelect={handleUserSelect}
              currentUserId={user.id}
              providerPhoneNumber={providerPhoneNumber}
              conversationLoadingById={conversationLoadingById}
              conversationActionResultById={conversationActionResultById}
              onStopConversationLoading={handleStopConversationLoading}
              onUsersUpdate={refreshUsers}
              onBroadcastToGroup={handleBroadcastToGroup}
              isMobile={false}
            />
          </div>
          
          {/* Chat Window - Desktop */}
          <div className="min-w-0 flex-1">
              <ChatWindow
              selectedUser={selectedUser}
              messages={messages}
              onSendMessage={handleSendMessage}
              messagingProvider={messagingProvider}
              onSendReaction={handleSendReaction}
              isLoading={sendingMessage}
              isMessagesLoading={threadLoading && !broadcastGroupName}
              onUpdateName={handleUpdateName}
              onUsersUpdate={refreshUsers}
              onMessageDeleted={(id) =>
                id === "__clear_all__"
                  ? setMessages([])
                  : setMessages((prev) => prev.filter((m) => m.id !== id))
              }
              onConversationActionActivity={handleConversationActionActivity}
              onClose={() => {
                setSelectedUser(null);
                setMessages([]);
                setBroadcastGroupId(null);
                setBroadcastGroupName(null);
              }}
              broadcastGroupName={broadcastGroupName}
              broadcastGroupId={broadcastGroupId}
            />
          </div>
        </>
      )}

      {/* Mobile Layout */}
      {isMobile && (
        <>
          {!showChat ? (
            // User List - Mobile
            <div className="w-full">
              <UserList 
                users={users}
                selectedUser={selectedUser}
                onUserSelect={handleUserSelect}
                currentUserId={user.id}
                providerPhoneNumber={providerPhoneNumber}
                conversationLoadingById={conversationLoadingById}
                conversationActionResultById={conversationActionResultById}
                onStopConversationLoading={handleStopConversationLoading}
                onUsersUpdate={refreshUsers}
                onBroadcastToGroup={handleBroadcastToGroup}
                isMobile={true}
              />
      </div>
          ) : (
            // Chat Window - Mobile
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
              <ChatWindow
                selectedUser={selectedUser}
                messages={messages}
                onSendMessage={handleSendMessage}
                messagingProvider={messagingProvider}
                onSendReaction={handleSendReaction}
                onMessageDeleted={(id) =>
                  id === "__clear_all__" ? setMessages([]) : setMessages((prev) => prev.filter((m) => m.id !== id))
                }
                onConversationActionActivity={handleConversationActionActivity}
                onBack={() => {
                  handleBackToUsers();
                  setBroadcastGroupId(null);
                  setBroadcastGroupName(null);
                }}
                isMobile={true}
                isLoading={sendingMessage}
                isMessagesLoading={threadLoading && !broadcastGroupName}
                onUpdateName={handleUpdateName}
                onUsersUpdate={refreshUsers}
                broadcastGroupName={broadcastGroupName}
                broadcastGroupId={broadcastGroupId}
              />
      </div>
          )}
        </>
      )}
    </div>
  );
}
