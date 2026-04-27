"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  Search,
  MessageCircle,
  LogOut,
  Plus,
  X,
  Phone,
  FileText,
  Settings,
  Users,
  Sparkles,
  Tag,
  Zap,
  Wrench,
  RefreshCw,
  ChevronDown,
  Bookmark,
  Loader2,
  CheckCircle2,
  CircleX,
  Languages,
  Palette,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  fetchContactStatusesCached,
  type ContactStatusNormalized,
} from "@/lib/contact-statuses-cache";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GroupsList } from "./groups-list";
import { GroupManagementDialog } from "./group-management-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TransferSectionKey =
  | "savedMessages"
  | "replyAgents"
  | "themeColors"
  | "translation"
  | "imagePrompts"
  | "contactData"
  | "statuses"
  | "dynamicActions";

const TRANSFER_SECTIONS: Array<{ key: TransferSectionKey; label: string }> = [
  { key: "savedMessages", label: "Saved messages" },
  { key: "replyAgents", label: "Reply Agents" },
  { key: "themeColors", label: "Theme & colors" },
  { key: "translation", label: "Translation" },
  { key: "imagePrompts", label: "Image Prompts" },
  { key: "contactData", label: "Contact data" },
  { key: "statuses", label: "Statuses" },
  { key: "dynamicActions", label: "Dynamic Actions" },
];

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
  avatar_url?: string | null;
  last_active: string;
  last_message?: string;
  last_message_time?: string;
  last_message_type?: string;
  last_message_sender?: string;
  unread_count?: number;
  status_id?: string | null;
  status_name?: string | null;
  status_color?: string | null;
}

interface Group {
  id: string;
  name: string;
  description?: string;
  member_count: number;
  unread_count?: number;
}

interface UserListProps {
  users: ChatUser[];
  selectedUser: ChatUser | null;
  onUserSelect: (user: ChatUser) => void;
  currentUserId: string;
  providerPhoneNumber?: string | null;
  conversationLoadingById?: Record<string, boolean>;
  /** Shown after a dynamic action completes until the user opens that conversation. */
  conversationActionResultById?: Record<string, "success" | "error">;
  /** Local-only cancel for stuck loading indicators. */
  onStopConversationLoading?: (contactId: string) => void;
  onUsersUpdate?: () => void;
  onBroadcastToGroup?: (groupId: string, groupName: string) => void;
  /** When true, disable per-conversation tag editing controls. */
  isMobile?: boolean;
}

interface NewUserInput {
  id: string;
  phoneNumber: string;
  customName: string;
}

/** Persists the conversation tag filter across refresh and client-side navigation. */
const TAG_FILTER_STORAGE_KEY = "chat:userListTagFilter";

/** Aligns with /api/messages/search contactId keys (digits-only phone). */
function contactSearchKey(id: string): string {
  const d = id.replace(/\D/g, "");
  if (d.length >= 6) return d;
  return id.trim();
}

function TagFilterRow({
  statuses,
  selectedStatusId,
  setSelectedStatusId,
}: {
  statuses: ContactStatusNormalized[];
  selectedStatusId: string | null;
  setSelectedStatusId: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
      <Button
        type="button"
        variant={selectedStatusId === null ? "default" : "outline"}
        size="sm"
        className="h-8 shrink-0 rounded-full px-3 text-xs"
        onClick={() => setSelectedStatusId(null)}
      >
        All
      </Button>
      {statuses.map((s) => (
        <Button
          key={s.id}
          type="button"
          variant={selectedStatusId === s.id ? "default" : "outline"}
          size="sm"
          className="h-8 shrink-0 rounded-full px-3 text-xs gap-2"
          onClick={() => setSelectedStatusId((prev) => (prev === s.id ? null : s.id))}
          title={s.name}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          <span className="max-w-[160px] truncate">{s.name}</span>
        </Button>
      ))}
    </div>
  );
}

export function UserList({
  users,
  selectedUser,
  onUserSelect,
  currentUserId,
  providerPhoneNumber = null,
  conversationLoadingById = {},
  conversationActionResultById = {},
  onStopConversationLoading,
  onUsersUpdate,
  onBroadcastToGroup,
  isMobile = false,
}: UserListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statuses, setStatuses] = useState<ContactStatusNormalized[]>([]);
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [tagFilterRestored, setTagFilterRestored] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, { status_id: string | null; status_name: string | null; status_color: string | null }>
  >({});
  const [updatingStatusFor, setUpdatingStatusFor] = useState<Set<string>>(new Set());
  const [showNewChat, setShowNewChat] = useState(false);
  const [newUsers, setNewUsers] = useState<NewUserInput[]>([
    { id: '1', phoneNumber: '', customName: '' }
  ]);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [syncingGreenHistory, setSyncingGreenHistory] = useState(false);
  const [syncGreenConfirmOpen, setSyncGreenConfirmOpen] = useState(false);
  const [syncGreenResult, setSyncGreenResult] = useState<
    | null
    | { ok: true; chatsProcessed: number; messagesUpserted: number; mediaStored: number }
    | { ok: false; error: string }
  >(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [transferTab, setTransferTab] = useState<"export" | "import">("export");
  const [selectedExportSections, setSelectedExportSections] = useState<Set<TransferSectionKey>>(
    () => new Set(TRANSFER_SECTIONS.map((s) => s.key)),
  );
  const [selectedImportSections, setSelectedImportSections] = useState<Set<TransferSectionKey>>(
    new Set(),
  );
  const [importFileName, setImportFileName] = useState("");
  const [importBundle, setImportBundle] = useState<unknown>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  /** Filter conversations by who sent the most recent message (requires last_message_sender). */
  const [lastReplyFilter, setLastReplyFilter] = useState<"all" | "client" | "me">("all");

  /** Tags filter: folded shows only the active tag; expand to pick another. */
  const [tagsExpanded, setTagsExpanded] = useState(false);

  /** DB search: messages + contact notebook (field keys/values); debounced when searchTerm ≥ 2 chars. */
  const [messageSearchMeta, setMessageSearchMeta] = useState<
    Map<string, { preview: string; matchCount: number; lastAt: string }>
  >(() => new Map());
  const [messageSearchLoading, setMessageSearchLoading] = useState(false);

  // Groups state
  const [groups, setGroups] = useState<Group[]>([]);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  
  const supabase = createClient();
  const router = useRouter();

  // Load groups on component mount
  useEffect(() => {
    loadGroups();
  }, []);

  // Load statuses (tags) on mount — shared cache with ChatWindow (no refetch per conversation)
  useEffect(() => {
    const load = async () => {
      try {
        const list = await fetchContactStatusesCached();
        setStatuses(list);
      } catch (e) {
        console.error("Error loading statuses:", e);
        setStatuses([]);
      }
    };
    void load();
  }, []);

  // Restore tag filter from storage (after mount so we don't clear storage on first persist)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TAG_FILTER_STORAGE_KEY);
      const id = raw?.trim();
      if (id) setSelectedStatusId(id);
    } catch {
      /* ignore */
    }
    setTagFilterRestored(true);
  }, []);

  // Persist tag filter whenever it changes (only after initial restore)
  useEffect(() => {
    if (!tagFilterRestored) return;
    try {
      if (selectedStatusId) localStorage.setItem(TAG_FILTER_STORAGE_KEY, selectedStatusId);
      else localStorage.removeItem(TAG_FILTER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [selectedStatusId, tagFilterRestored]);

  // Drop stored filter if the tag no longer exists
  useEffect(() => {
    if (statuses.length === 0) return;
    setSelectedStatusId((prev) => {
      if (!prev) return prev;
      if (statuses.some((s) => s.id === prev)) return prev;
      try {
        localStorage.removeItem(TAG_FILTER_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return null;
    });
  }, [statuses]);

  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) {
      setMessageSearchMeta(new Map());
      setMessageSearchLoading(false);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void (async () => {
        setMessageSearchLoading(true);
        try {
          const res = await fetch(
            `/api/messages/search?q=${encodeURIComponent(q)}`,
            { signal: ac.signal },
          );
          const data = (await res.json()) as {
            matches?: Array<{
              contactId: string;
              preview: string;
              matchCount: number;
              lastAt: string;
            }>;
          };
          if (!res.ok) {
            setMessageSearchMeta(new Map());
            return;
          }
          const m = new Map<string, { preview: string; matchCount: number; lastAt: string }>();
          for (const x of data.matches || []) {
            m.set(x.contactId, {
              preview: x.preview,
              matchCount: x.matchCount,
              lastAt: x.lastAt,
            });
          }
          setMessageSearchMeta(m);
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            console.error("Message search:", e);
          }
          setMessageSearchMeta(new Map());
        } finally {
          setMessageSearchLoading(false);
        }
      })();
    }, 400);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [searchTerm]);

  const loadGroups = async () => {
    try {
      const response = await fetch('/api/groups');
      const data = await response.json();
      
      if (data.success && data.groups) {
        // Defensive: ensure unique group ids (React keys must be unique)
        const map = new Map<string, Group>();
        for (const g of data.groups as Group[]) {
          if (!g?.id) continue;
          map.set(String(g.id), g);
        }
        setGroups(Array.from(map.values()));
      }
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  };

  // Helper functions defined first to avoid hoisting issues
  const getDisplayName = (user: ChatUser) => {
    // Priority: custom_name > whatsapp_name > phone number
    return user.custom_name || user.whatsapp_name || user.id;
  };

  const getSecondaryName = (user: ChatUser) => {
    // Show whatsapp name if we have a custom name, or phone number if we only have whatsapp name
    if (user.custom_name && user.whatsapp_name) {
      return user.whatsapp_name;
    }
    if (user.whatsapp_name && user.whatsapp_name !== user.id) {
      return user.id;
    }
    return null;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 168) { // 7 days
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const matchesLastReplyFilter = useCallback(
    (user: ChatUser) => {
      if (lastReplyFilter === "all") return true;
      const hasAnyMessage = Boolean(user.last_message || user.last_message_type);
      if (!hasAnyMessage) return false;
      const sender = user.last_message_sender;
      if (lastReplyFilter === "me") return sender === currentUserId;
      return Boolean(sender && sender !== currentUserId);
    },
    [lastReplyFilter, currentUserId],
  );

  const messagePreviewMeta = (user: ChatUser) => {
    if (!user.last_message && !user.last_message_type) {
      return { isYou: false, body: "No messages yet" as const };
    }

    const isFromCurrentUser = user.last_message_sender === currentUserId;

    if (user.last_message_type && user.last_message_type !== "text") {
      let label = "";
      switch (user.last_message_type) {
        case "image":
          label = "📷 Photo";
          break;
        case "video":
          label = "🎥 Video";
          break;
        case "audio":
          label = "🎵 Audio";
          break;
        case "document":
          label = "📄 Document";
          break;
        default:
          label = "📎 Media";
      }
      return { isYou: isFromCurrentUser, body: label };
    }

    const message = user.last_message || "";
    const truncated =
      message.length > 30 ? `${message.substring(0, 30)}...` : message;
    return { isYou: isFromCurrentUser, body: truncated };
  };

  const getMessagePreview = (user: ChatUser) => {
    const { isYou, body } = messagePreviewMeta(user);
    if (body === "No messages yet") return body;
    return isYou ? `You : ${body}` : body;
  };

  const renderMessagePreview = (user: ChatUser): ReactNode => {
    const { isYou, body } = messagePreviewMeta(user);
    if (body === "No messages yet") return body;
    return (
      <>
        {isYou && (
          <span
            className="shrink-0 font-semibold text-chat-you"
            aria-label="You sent"
          >
            You{" : "}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{body}</span>
      </>
    );
  };

  // Sort conversations newest-first (stable when opening/marking read)
  const sortedUsers = users
    .filter(user => user.id !== currentUserId)
    .sort((a, b) => {
      // Sort by last message time (or last active as fallback)
      const aTime = new Date(a.last_message_time || a.last_active).getTime();
      const bTime = new Date(b.last_message_time || b.last_active).getTime();
      if (bTime !== aTime) return bTime - aTime;

      // Stable tie-breakers
      const aUnread = a.unread_count || 0;
      const bUnread = b.unread_count || 0;
      if (bUnread !== aUnread) return bUnread - aUnread;
      return String(a.id).localeCompare(String(b.id));
    });

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const base = sortedUsers.filter((user) => {
      const displayName = getDisplayName(user);
      const searchableText =
        `${displayName} ${user.whatsapp_name || ""} ${user.id}`.toLowerCase();
      const matchesName = !q || searchableText.includes(q);
      const matchesMessage =
        q.length >= 2 && messageSearchMeta.has(contactSearchKey(user.id));
      const matchesSearch = !q || matchesName || matchesMessage;

      const effectiveStatusId =
        (statusOverrides[user.id]?.status_id ?? user.status_id) || null;
      const matchesStatus = selectedStatusId
        ? effectiveStatusId === selectedStatusId
        : true;
      return matchesSearch && matchesStatus && matchesLastReplyFilter(user);
    });

    if (!q || q.length < 2 || messageSearchMeta.size === 0) {
      return base;
    }

    return [...base].sort((a, b) => {
      const ma = messageSearchMeta.has(contactSearchKey(a.id));
      const mb = messageSearchMeta.has(contactSearchKey(b.id));
      if (ma && !mb) return -1;
      if (!ma && mb) return 1;
      if (ma && mb) {
        const ca = messageSearchMeta.get(contactSearchKey(a.id))!.matchCount;
        const cb = messageSearchMeta.get(contactSearchKey(b.id))!.matchCount;
        if (cb !== ca) return cb - ca;
      }
      const aTime = new Date(a.last_message_time || a.last_active).getTime();
      const bTime = new Date(b.last_message_time || b.last_active).getTime();
      return bTime - aTime;
    });
  }, [
    sortedUsers,
    searchTerm,
    messageSearchMeta,
    selectedStatusId,
    statusOverrides,
    matchesLastReplyFilter,
  ]);

  const assignContactStatus = async (contactId: string, statusId: string | null) => {
    if (!contactId) return;
    if (updatingStatusFor.has(contactId)) return;
    setUpdatingStatusFor((prev) => new Set(prev).add(contactId));
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_id: statusId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update status");

      const picked =
        statusId ? statuses.find((s) => s.id === statusId) ?? null : null;

      setStatusOverrides((prev) => ({
        ...prev,
        [contactId]: {
          status_id: statusId,
          status_name: picked?.name ?? null,
          status_color: picked?.color ?? null,
        },
      }));

      // Refresh list (so unread/last_message and DB-backed views stay consistent)
      await onUsersUpdate?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update tag");
    } finally {
      setUpdatingStatusFor((prev) => {
        const next = new Set(prev);
        next.delete(contactId);
        return next;
      });
    }
  };

  const runSyncGreenHistory = async () => {
    if (syncingGreenHistory) return;
    setSyncGreenResult(null);
    setSyncingGreenHistory(true);
    try {
      const resp = await fetch("/api/green/sync-history", { method: "POST" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.error || "Failed to sync history");
      }
      await onUsersUpdate?.();
      setSyncGreenResult({
        ok: true,
        chatsProcessed: Number(data?.chatsProcessed ?? 0),
        messagesUpserted: Number(data?.messagesUpserted ?? 0),
        mediaStored: Number(data?.mediaStored ?? 0),
      });
    } catch (e) {
      setSyncGreenResult({
        ok: false,
        error: e instanceof Error ? e.message : "Failed to sync history",
      });
    } finally {
      setSyncingGreenHistory(false);
    }
  };

  const toggleSection = (
    setFn: Dispatch<SetStateAction<Set<TransferSectionKey>>>,
    key: TransferSectionKey,
  ) => {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleExportConfig = async () => {
    if (transferBusy) return;
    if (selectedExportSections.size === 0) {
      alert("Pick at least one section to export.");
      return;
    }
    setTransferBusy(true);
    try {
      const res = await fetch("/api/account-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "export",
          sections: Array.from(selectedExportSections),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Export failed");
      const bundle = data?.bundle;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `wachat-account-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Export failed");
    } finally {
      setTransferBusy(false);
    }
  };

  const handlePickImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const root = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      const sectionsRaw = root?.sections;
      const available = new Set<TransferSectionKey>();
      if (Array.isArray(sectionsRaw)) {
        for (const s of sectionsRaw) {
          if (typeof s === "string" && TRANSFER_SECTIONS.some((item) => item.key === s)) {
            available.add(s as TransferSectionKey);
          }
        }
      } else {
        for (const item of TRANSFER_SECTIONS) available.add(item.key);
      }
      setImportBundle(parsed);
      setImportFileName(file.name);
      setSelectedImportSections(available);
    } catch {
      alert("Invalid JSON file.");
      setImportBundle(null);
      setImportFileName("");
      setSelectedImportSections(new Set());
    }
  };

  const handleImportConfig = async () => {
    if (transferBusy) return;
    if (!importBundle) {
      alert("Choose a JSON file first.");
      return;
    }
    if (selectedImportSections.size === 0) {
      alert("Pick at least one section to import.");
      return;
    }
    setTransferBusy(true);
    try {
      const res = await fetch("/api/account-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "import",
          file: importBundle,
          sections: Array.from(selectedImportSections),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Import failed");
      await onUsersUpdate?.();
      alert("Import completed successfully.");
      setShowImportExport(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed");
    } finally {
      setTransferBusy(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleAddUserInput = () => {
    setNewUsers([...newUsers, { id: Date.now().toString(), phoneNumber: '', customName: '' }]);
  };

  const handleRemoveUserInput = (id: string) => {
    if (newUsers.length > 1) {
      setNewUsers(newUsers.filter(user => user.id !== id));
    }
  };

  const handleUpdateUserInput = (id: string, field: 'phoneNumber' | 'customName', value: string) => {
    setNewUsers(newUsers.map(user => 
      user.id === id ? { ...user, [field]: value } : user
    ));
  };

  const handleCreateNewChat = async () => {
    // Filter out empty entries
    const validUsers = newUsers.filter(u => u.phoneNumber.trim());
    
    if (validUsers.length === 0) {
      alert('Please enter at least one phone number');
      return;
    }

    setIsCreatingChat(true);
    try {
      // Single user creation (backward compatible)
      if (validUsers.length === 1) {
        const response = await fetch('/api/users/create-chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phoneNumber: validUsers[0].phoneNumber.trim(),
            customName: validUsers[0].customName.trim() || null
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || result.error || 'Failed to create chat');
        }

        console.log('Chat created successfully:', result);
        
        // Reset form
        setNewUsers([{ id: '1', phoneNumber: '', customName: '' }]);
        setShowNewChat(false);

        // Refresh users list
        if (onUsersUpdate) {
          onUsersUpdate();
        }

        // Select the new/existing user
        onUserSelect(result.user);

      } else {
        // Bulk user creation
        const response = await fetch('/api/users/create-chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            users: validUsers.map(u => ({
              phoneNumber: u.phoneNumber.trim(),
              customName: u.customName.trim() || null
            }))
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Failed to create chats');
        }

        console.log('Bulk chat creation result:', result.results);
        
        // Show summary
        const successCount = result.results.successCount;
        const failedCount = result.results.failedCount;
        
        let message = `Successfully added ${successCount} contact${successCount !== 1 ? 's' : ''}`;
        
        if (failedCount > 0) {
          message += `\n\nFailed to add ${failedCount} contact${failedCount !== 1 ? 's' : ''}:`;
          result.results.failed.forEach((failure: { phoneNumber: string; error: string }) => {
            message += `\n- ${failure.phoneNumber}: ${failure.error}`;
          });
        }
        
        alert(message);
        
        // Reset form
        setNewUsers([{ id: '1', phoneNumber: '', customName: '' }]);
        setShowNewChat(false);

        // Refresh users list
        if (onUsersUpdate) {
          onUsersUpdate();
        }
      }

    } catch (error) {
      console.error('Error creating chat:', error);
      alert(`Failed to create chat: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsCreatingChat(false);
    }
  };

  // Group handlers
  const handleCreateGroup = () => {
    setEditingGroup(null);
    setShowGroupDialog(true);
  };

  const handleEditGroup = (group: Group) => {
    setEditingGroup(group);
    setShowGroupDialog(true);
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      const response = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        loadGroups();
        if (onUsersUpdate) {
          onUsersUpdate();
        }
      } else {
        console.error('Failed to delete group');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
    }
  };

  const handleGroupSaved = () => {
    loadGroups();
    if (onUsersUpdate) {
      onUsersUpdate();
    }
  };

  const handleBroadcastToGroup = (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group && onBroadcastToGroup) {
      onBroadcastToGroup(groupId, group.name);
    }
  };

  const handleSelectMemberFromGroup = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (user) {
      onUserSelect(user);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {syncGreenConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sync-green-title"
          onClick={() => {
            if (syncingGreenHistory) return;
            setSyncGreenConfirmOpen(false);
            setSyncGreenResult(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <RefreshCw className={`h-6 w-6 shrink-0 ${syncingGreenHistory ? "animate-spin" : ""}`} />
              <div className="min-w-0">
                <h2 id="sync-green-title" className="text-lg font-semibold">
                  Sync history (Green API)
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This will import as many chats/messages as possible and store messages + media in your database/storage.
                  Depending on your account size, it may take a while.
                </p>
              </div>
            </div>

            {syncGreenResult?.ok === true && (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/20 dark:text-green-200">
                <div className="font-medium">Sync complete</div>
                <div className="mt-1 text-xs">
                  Chats processed: {syncGreenResult.chatsProcessed} · Messages upserted: {syncGreenResult.messagesUpserted} · Media stored: {syncGreenResult.mediaStored}
                </div>
              </div>
            )}

            {syncGreenResult?.ok === false && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
                <div className="font-medium">Sync failed</div>
                <div className="mt-1 text-xs break-words">{syncGreenResult.error}</div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={syncingGreenHistory}
                onClick={() => {
                  setSyncGreenConfirmOpen(false);
                  setSyncGreenResult(null);
                }}
              >
                {syncGreenResult?.ok === true ? "Close" : "Cancel"}
              </Button>
              <Button
                type="button"
                className="bg-chat-menu text-chat-menu-fg hover:bg-chat-menu-hover"
                disabled={syncingGreenHistory || syncGreenResult?.ok === true}
                onClick={() => void runSyncGreenHistory()}
              >
                {syncingGreenHistory ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showImportExport && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-export-title"
          onClick={() => {
            if (transferBusy) return;
            setShowImportExport(false);
          }}
        >
          <div
            className="w-full max-w-2xl rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 id="import-export-title" className="text-lg font-semibold">
                  Import / Export
                </h2>
                <p className="text-sm text-muted-foreground">
                  Move account configuration between accounts using one JSON file.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowImportExport(false)}
                disabled={transferBusy}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Tabs value={transferTab} onValueChange={(v) => setTransferTab(v === "import" ? "import" : "export")}>
              <TabsList>
                <TabsTrigger value="export">Export</TabsTrigger>
                <TabsTrigger value="import">Import</TabsTrigger>
              </TabsList>

              <TabsContent value="export" className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Choose what to export</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {TRANSFER_SECTIONS.map((section) => (
                      <label key={section.key} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedExportSections.has(section.key)}
                          onChange={() => toggleSection(setSelectedExportSections, section.key)}
                        />
                        <span>{section.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowImportExport(false)} disabled={transferBusy}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleExportConfig()} disabled={transferBusy}>
                    <ArrowDownToLine className="h-4 w-4" />
                    {transferBusy ? "Exporting..." : "Export JSON"}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="import" className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Pick export file</div>
                  <Input
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => void handlePickImportFile(e.target.files?.[0] ?? null)}
                    disabled={transferBusy}
                  />
                  {importFileName ? (
                    <p className="text-xs text-muted-foreground">Loaded: {importFileName}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Choose what to import</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {TRANSFER_SECTIONS.map((section) => {
                      const enabled = importBundle !== null && selectedImportSections.has(section.key);
                      return (
                        <label key={section.key} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedImportSections.has(section.key)}
                            onChange={() => toggleSection(setSelectedImportSections, section.key)}
                            disabled={importBundle === null}
                          />
                          <span className={enabled ? "" : "text-muted-foreground"}>{section.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowImportExport(false)} disabled={transferBusy}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleImportConfig()} disabled={transferBusy || importBundle === null}>
                    <ArrowUpFromLine className="h-4 w-4" />
                    {transferBusy ? "Importing..." : "Import to this account"}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="border-b border-border bg-chat-menu p-4 text-chat-menu-fg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-6 w-6" />
            <h1 className="text-lg font-semibold">{providerPhoneNumber?.trim() || "WhatsApp"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNewChat(true)}
              className="rounded-full p-2 text-chat-menu-fg transition-colors hover:bg-chat-menu-hover"
              title="New chat"
            >
              <Plus className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateGroup}
              className="rounded-full p-2 text-chat-menu-fg transition-colors hover:bg-chat-menu-hover"
              title="Create broadcast group"
            >
              <Users className="h-5 w-5" />
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full p-2 text-chat-menu-fg transition-colors hover:bg-chat-menu-hover"
                  title="Tools"
                  disabled={syncingGreenHistory}
                >
                  <Wrench className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Tools</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setSyncGreenConfirmOpen(true);
                  }}
                  disabled={syncingGreenHistory}
                >
                  <RefreshCw className="h-4 w-4" />
                  {syncingGreenHistory ? "Syncing Green history…" : "Sync history (Green API)"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/protected/saved-messages" className="flex items-center gap-2">
                    <Bookmark className="h-4 w-4" />
                    Saved messages
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/templates" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Message Templates
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/reply-agents" className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Reply Agents
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/theme" className="flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    Theme & colors
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/translation" className="flex items-center gap-2">
                    <Languages className="h-4 w-4" />
                    Translation
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/image-prompts" className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Image Prompts
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/statuses" className="flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Statuses
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/protected/actions" className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Dynamic Actions
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowImportExport(true);
                  }}
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  Import / Export
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Link href="/protected/setup">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full p-2 text-chat-menu-fg transition-colors hover:bg-chat-menu-hover"
                title="WhatsApp Setup"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </Link>
            <div className="[&>button]:text-chat-menu-fg [&>button]:hover:bg-chat-menu-hover">
              <ThemeSwitcher />
            </div>
            <button
              onClick={handleLogout}
              className="rounded-full p-2 text-chat-menu-fg transition-colors hover:bg-chat-menu-hover"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* New Chat Form - Bulk Contact Creation */}
      {showNewChat && (
        <div className="p-4 border-b border-border bg-muted/50 max-h-[400px] overflow-y-auto">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Add Contact{newUsers.length > 1 ? 's' : ''}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNewChat(false);
                  setNewUsers([{ id: '1', phoneNumber: '', customName: '' }]);
                }}
                className="p-1 h-6 w-6"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Contact Inputs */}
            <div className="space-y-3">
              {newUsers.map((user, index) => (
                <div key={user.id} className="space-y-2 p-3 border border-border rounded-lg bg-background">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Contact {index + 1}
                    </span>
                    {newUsers.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveUserInput(user.id)}
                        disabled={isCreatingChat}
                        className="p-1 h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        title="Remove this contact"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Input
                      placeholder="Phone number (e.g., 918097296453)"
                      value={user.phoneNumber}
                      onChange={(e) => handleUpdateUserInput(user.id, 'phoneNumber', e.target.value)}
                      className="text-sm"
                      disabled={isCreatingChat}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <Input
                      placeholder="Name (optional)"
                      value={user.customName}
                      onChange={(e) => handleUpdateUserInput(user.id, 'customName', e.target.value)}
                      className="text-sm"
                      disabled={isCreatingChat}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Add More Button */}
            {newUsers.length < 20 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddUserInput}
                disabled={isCreatingChat}
                className="w-full border-dashed"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Another Contact
              </Button>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreateNewChat}
                disabled={isCreatingChat || newUsers.every(u => !u.phoneNumber.trim())}
                className="flex-1 bg-chat-menu text-chat-menu-fg hover:bg-chat-menu-hover"
                size="sm"
              >
                {isCreatingChat ? "Adding..." : `Add Contact${newUsers.filter(u => u.phoneNumber.trim()).length > 1 ? 's' : ''}`}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowNewChat(false);
                  setNewUsers([{ id: '1', phoneNumber: '', customName: '' }]);
                }}
                disabled={isCreatingChat}
                size="sm"
              >
                Cancel
              </Button>
            </div>
            
            {/* Helper Text */}
            <p className="text-xs text-muted-foreground text-center">
              {newUsers.filter(u => u.phoneNumber.trim()).length} contact{newUsers.filter(u => u.phoneNumber.trim()).length !== 1 ? 's' : ''} to add
              {newUsers.length < 20 && ` • Max 20 at once`}
            </p>
          </div>
        </div>
      )}

      {/* Tags (Statuses) — always visible on mobile; foldable on desktop */}
      <div className="border-b border-border px-3 pb-2 pt-3 sm:px-4">
        {isMobile ? (
          <TagFilterRow
            statuses={statuses}
            selectedStatusId={selectedStatusId}
            setSelectedStatusId={setSelectedStatusId}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setTagsExpanded((v) => !v)}
              aria-expanded={tagsExpanded}
              className="flex w-full min-w-0 items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
            >
              <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                Tags
              </span>
              {!tagsExpanded && (
                <div className="flex min-w-0 flex-1 items-center justify-end sm:justify-start">
                  {selectedStatusId ? (
                    (() => {
                      const s = statuses.find((x) => x.id === selectedStatusId);
                      return (
                        <span className="inline-flex max-w-[min(100%,11rem)] items-center gap-2 rounded-full border border-border/80 bg-gradient-to-r from-muted/50 to-muted/30 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
                          {s?.color ? (
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background"
                              style={{ backgroundColor: s.color }}
                            />
                          ) : (
                            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border" />
                          )}
                          <span className="truncate">{s?.name ?? "Tag"}</span>
                        </span>
                      );
                    })()
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
                      All
                    </span>
                  )}
                </div>
              )}
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  tagsExpanded && "rotate-180"
                )}
                aria-hidden
              />
            </button>

            {tagsExpanded ? (
              <div className="mt-2">
                <TagFilterRow
                  statuses={statuses}
                  selectedStatusId={selectedStatusId}
                  setSelectedStatusId={setSelectedStatusId}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Search + last-sender filter */}
      <div className="p-3 sm:p-4 border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <input
            type="text"
            placeholder="Search name, phone, messages, or contact data…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-chat-menu"
            aria-busy={messageSearchLoading}
          />
          {messageSearchLoading && (
            <Loader2
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          )}
        </div>
        {searchTerm.trim().length >= 2 && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            Searching all stored messages (2+ characters). Multiple words must all appear in the same
            message.
          </p>
        )}
        <div
          className="flex rounded-lg border border-border/80 bg-muted/35 p-0.5 shadow-sm"
          role="group"
          aria-label="Last message in thread"
        >
          {(
            [
              { id: "all" as const, label: "All", title: "All conversations" },
              {
                id: "client" as const,
                label: "Them",
                title: "Their last message (contact)",
              },
              { id: "me" as const, label: "You", title: "Your last message" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.title}
              onClick={() => setLastReplyFilter(opt.id)}
              className={cn(
                "min-w-0 flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium leading-none transition-colors sm:px-2",
                lastReplyFilter === opt.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Groups List */}
      {groups.length > 0 && (
        <div className="border-b border-border">
          <GroupsList
            groups={groups}
            onEditGroup={handleEditGroup}
            onDeleteGroup={handleDeleteGroup}
            onSelectMember={handleSelectMemberFromGroup}
            onBroadcastToGroup={handleBroadcastToGroup}
          />
        </div>
      )}

      {/* User List */}
      <div className="flex-1 overflow-y-auto">
        {filteredUsers.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {searchTerm || lastReplyFilter !== "all" || selectedStatusId
              ? "No conversations match your filters"
              : "No conversations yet"}
            {!searchTerm && lastReplyFilter === "all" && !selectedStatusId && (
              <div className="mt-4">
                <Button
                  onClick={() => setShowNewChat(true)}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Start New Chat
                </Button>
              </div>
            )}
          </div>
        ) : (
          filteredUsers.map((user) => (
            <div
              key={user.id}
              className={cn(
                "border-b border-border p-4 cursor-pointer select-none",
                "transition-colors duration-100 hover:bg-muted/50",
                selectedUser?.id === user.id &&
                  "bg-muted shadow-[inset_0_1px_0_0_hsl(var(--chat-you)/0.12)] ring-2 ring-inset ring-chat-you/55"
              )}
              aria-current={selectedUser?.id === user.id ? "true" : undefined}
              onClick={() => onUserSelect(user)}
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  {user.avatar_url ? (
                    <AvatarImage
                      src={user.avatar_url}
                      alt={getDisplayName(user)}
                      referrerPolicy="no-referrer"
                      onError={() => {
                        console.warn("[avatar] image failed to load", {
                          contactId: user.id,
                          avatar_url: user.avatar_url,
                        });
                      }}
                    />
                  ) : null}
                  <AvatarFallback className="bg-chat-menu/15 font-semibold text-chat-menu">
                    {getDisplayName(user).charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3
                          className={`font-medium truncate ${
                            (user.unread_count || 0) > 0 ? "font-semibold" : ""
                          }`}
                        >
                          {getDisplayName(user)}
                        </h3>
                      </div>
                      
                      {/* Secondary name display */}
                      {getSecondaryName(user) && (
                        <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                          {user.whatsapp_name && user.custom_name ? (
                            <>WhatsApp: {user.whatsapp_name}</>
                          ) : (
                            <>
                              <Phone className="h-3 w-3" />
                              {user.id}
                            </>
                          )}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 ml-2">
                      {conversationLoadingById[user.id] ? (
                        <div className="flex items-center gap-1">
                          <span title="Action in progress" aria-label="Action in progress">
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
                              aria-hidden="true"
                            />
                          </span>
                          <button
                            type="button"
                            className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/80 hover:bg-muted hover:text-foreground"
                            title="Stop loading indicator (local only)"
                            aria-label="Stop loading indicator"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStopConversationLoading?.(user.id);
                            }}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      ) : conversationActionResultById[user.id] === "success" ? (
                        <span title="Action completed" aria-label="Action completed">
                          <CheckCircle2
                            className="h-3.5 w-3.5 text-emerald-500"
                            aria-hidden="true"
                          />
                        </span>
                      ) : conversationActionResultById[user.id] === "error" ? (
                        <span title="Action failed" aria-label="Action failed">
                          <CircleX
                            className="h-3.5 w-3.5 text-destructive"
                            aria-hidden="true"
                          />
                        </span>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {formatTime(user.last_message_time || user.last_active)}
                      </span>
                    {(() => {
                      const ov = statusOverrides[user.id];
                      const statusName = ov?.status_name ?? user.status_name ?? null;
                      const statusColor = ov?.status_color ?? user.status_color ?? null;
                      const isUpdating = updatingStatusFor.has(user.id);

                      if (isMobile) {
                        return (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-foreground/90",
                              isUpdating && "opacity-60",
                            )}
                            title={statusName ? `Status: ${statusName}` : "Tag"}
                            aria-label={statusName ? `Tag: ${statusName}` : "Tag"}
                          >
                            {statusName && statusColor ? (
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: String(statusColor) }}
                              />
                            ) : (
                              <span className="inline-block h-2 w-2 rounded-full border" />
                            )}
                            <span className="max-w-[120px] truncate">
                              {statusName ?? "Tag"}
                            </span>
                          </span>
                        );
                      }

                      return (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-foreground/90 hover:bg-muted/60 transition-colors ${
                                isUpdating ? "opacity-60" : ""
                              }`}
                              title={statusName ? `Status: ${statusName}` : "Set tag"}
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              disabled={isUpdating}
                            >
                              {statusName && statusColor ? (
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: String(statusColor) }}
                                />
                              ) : (
                                <span className="inline-block h-2 w-2 rounded-full border" />
                              )}
                              <span className="max-w-[120px] truncate">
                                {statusName ?? "Tag"}
                              </span>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-56"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenuLabel>Choose tag</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => {
                                void assignContactStatus(user.id, null);
                              }}
                            >
                              No tag
                            </DropdownMenuItem>
                            {statuses.map((s) => (
                              <DropdownMenuItem
                                key={s.id}
                                onSelect={() => {
                                  void assignContactStatus(user.id, s.id);
                                }}
                              >
                                <span
                                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: s.color }}
                                />
                                <span className="truncate">{s.name}</span>
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link
                                href="/protected/statuses"
                                className="flex cursor-pointer items-center gap-2"
                              >
                                <Tag className="h-4 w-4" />
                                Manage tags
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })()}
                      {(user.unread_count || 0) > 0 && (
                        <div className="flex h-5 w-5 animate-scale-in items-center justify-center rounded-full bg-chat-menu text-xs font-medium text-chat-menu-fg shadow-md">
                          {user.unread_count! > 99 ? '99+' : user.unread_count}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <p
                    className={`text-sm mt-1 flex min-w-0 items-center ${
                      messageSearchMeta.has(contactSearchKey(user.id))
                        ? "text-foreground"
                        : `text-muted-foreground ${
                            (user.unread_count || 0) > 0 ? "font-medium text-foreground" : ""
                          }`
                    }`}
                    title={
                      messageSearchMeta.get(contactSearchKey(user.id))?.preview ||
                      getMessagePreview(user)
                    }
                  >
                    {messageSearchMeta.has(contactSearchKey(user.id)) ? (
                      <>
                        <span className="font-medium text-chat-you">
                          Match
                          {messageSearchMeta.get(contactSearchKey(user.id))!.matchCount > 1
                            ? ` (${messageSearchMeta.get(contactSearchKey(user.id))!.matchCount})`
                            : ""}
                          :{" "}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {messageSearchMeta.get(contactSearchKey(user.id))!.preview || "—"}
                        </span>
                      </>
                    ) : (
                      renderMessagePreview(user)
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Group Management Dialog */}
      <GroupManagementDialog
        isOpen={showGroupDialog}
        onClose={() => {
          setShowGroupDialog(false);
          setEditingGroup(null);
        }}
        users={users}
        group={editingGroup}
        onGroupSaved={handleGroupSaved}
      />
    </div>
  );
}