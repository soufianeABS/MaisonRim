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
  Edit3,
  Check,
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
} from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
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

type ContactStatus = {
  id: string;
  name: string;
  color: string;
};

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
  onUsersUpdate?: () => void;
  onBroadcastToGroup?: (groupId: string, groupName: string) => void;
}

interface NewUserInput {
  id: string;
  phoneNumber: string;
  customName: string;
}

export function UserList({ users, selectedUser, onUserSelect, currentUserId, onUsersUpdate, onBroadcastToGroup }: UserListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statuses, setStatuses] = useState<ContactStatus[]>([]);
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, { status_id: string | null; status_name: string | null; status_color: string | null }>
  >({});
  const [updatingStatusFor, setUpdatingStatusFor] = useState<Set<string>>(new Set());
  const [showNewChat, setShowNewChat] = useState(false);
  const [newUsers, setNewUsers] = useState<NewUserInput[]>([
    { id: '1', phoneNumber: '', customName: '' }
  ]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isUpdatingName, setIsUpdatingName] = useState(false);
  const [syncingGreenHistory, setSyncingGreenHistory] = useState(false);
  const [syncGreenConfirmOpen, setSyncGreenConfirmOpen] = useState(false);
  const [syncGreenResult, setSyncGreenResult] = useState<
    | null
    | { ok: true; chatsProcessed: number; messagesUpserted: number; mediaStored: number }
    | { ok: false; error: string }
  >(null);
  
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

  // Load statuses (tags) on component mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/contact-statuses", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load statuses");
        setStatuses(Array.isArray(data?.statuses) ? data.statuses : []);
      } catch (e) {
        console.error("Error loading statuses:", e);
        setStatuses([]);
      }
    };
    void load();
  }, []);

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

  const getMessagePreview = (user: ChatUser) => {
    if (!user.last_message && !user.last_message_type) {
      return "No messages yet";
    }

    // Handle media messages
    if (user.last_message_type && user.last_message_type !== 'text') {
      const isFromCurrentUser = user.last_message_sender === currentUserId;
      const prefix = isFromCurrentUser ? "You: " : "";
      
      switch (user.last_message_type) {
        case 'image':
          return `${prefix}📷 Photo`;
        case 'video':
          return `${prefix}🎥 Video`;
        case 'audio':
          return `${prefix}🎵 Audio`;
        case 'document':
          return `${prefix}📄 Document`;
        default:
          return `${prefix}📎 Media`;
      }
    }

    // Handle text messages
    const message = user.last_message || "";
    const isFromCurrentUser = user.last_message_sender === currentUserId;
    const prefix = isFromCurrentUser ? "You: " : "";
    
    return `${prefix}${message.length > 30 ? message.substring(0, 30) + "..." : message}`;
  };

  // Sort users by last message time (most recent first) and then by unread count
  const sortedUsers = users
    .filter(user => user.id !== currentUserId)
    .sort((a, b) => {
      // First, prioritize users with unread messages
      if ((a.unread_count || 0) > 0 && (b.unread_count || 0) === 0) return -1;
      if ((a.unread_count || 0) === 0 && (b.unread_count || 0) > 0) return 1;
      
      // Then sort by last message time
      const aTime = new Date(a.last_message_time || a.last_active).getTime();
      const bTime = new Date(b.last_message_time || b.last_active).getTime();
      return bTime - aTime;
    });

  const filteredUsers = sortedUsers.filter(user => {
    const displayName = getDisplayName(user);
    const searchableText = `${displayName} ${user.whatsapp_name || ''} ${user.id}`.toLowerCase();
    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());
    const effectiveStatusId = (statusOverrides[user.id]?.status_id ?? user.status_id) || null;
    const matchesStatus = selectedStatusId ? effectiveStatusId === selectedStatusId : true;
    return matchesSearch && matchesStatus;
  });

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

  const handleStartEditName = (user: ChatUser) => {
    setEditingUserId(user.id);
    setEditingName(user.custom_name || '');
  };

  const handleSaveEditName = async (userId: string) => {
    setIsUpdatingName(true);
    try {
      const response = await fetch('/api/users/update-name', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          customName: editingName.trim() || null
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || result.error || 'Failed to update name');
      }

      console.log('Name updated successfully:', result);
      
      // Reset editing state
      setEditingUserId(null);
      setEditingName("");

      // Refresh users list
      if (onUsersUpdate) {
        onUsersUpdate();
      }

    } catch (error) {
      console.error('Error updating name:', error);
      alert(`Failed to update name: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUpdatingName(false);
    }
  };

  const handleCancelEditName = () => {
    setEditingUserId(null);
    setEditingName("");
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
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={syncingGreenHistory || syncGreenResult?.ok === true}
                onClick={() => void runSyncGreenHistory()}
              >
                {syncingGreenHistory ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="p-4 border-b border-border bg-green-600 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-6 w-6" />
            <h1 className="text-lg font-semibold">WhatsApp</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNewChat(true)}
              className="p-2 text-white hover:bg-green-700 rounded-full transition-colors"
              title="New chat"
            >
              <Plus className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateGroup}
              className="p-2 text-white hover:bg-green-700 rounded-full transition-colors"
              title="Create broadcast group"
            >
              <Users className="h-5 w-5" />
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-2 text-white hover:bg-green-700 rounded-full transition-colors"
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
              </DropdownMenuContent>
            </DropdownMenu>
            <Link href="/protected/setup">
              <Button
                variant="ghost"
                size="sm"
                className="p-2 text-white hover:bg-green-700 rounded-full transition-colors"
                title="WhatsApp Setup"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </Link>
            <div className="[&>button]:text-white [&>button]:hover:bg-green-700">
              <ThemeSwitcher />
            </div>
            <button
              onClick={handleLogout}
              className="p-2 hover:bg-green-700 rounded-full transition-colors"
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
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
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

      {/* Tags (Statuses) */}
      <div className="px-4 pt-4 pb-2 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">Tags</span>
          {selectedStatusId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedStatusId(null)}
              title="Clear tag filter"
            >
              Clear
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
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
      </div>

      {/* Search */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-green-500"
          />
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
            {searchTerm ? "No conversations found" : "No conversations yet"}
            {!searchTerm && (
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
              className={`group p-4 border-b border-border cursor-pointer hover:bg-muted/50 transition-all duration-200 ${
                selectedUser?.id === user.id ? "bg-muted" : ""
              }`}
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
                  <AvatarFallback className="bg-green-100 text-green-700 font-semibold">
                    {getDisplayName(user).charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0" onClick={() => onUserSelect(user)}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      {editingUserId === user.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="h-6 text-sm"
                            placeholder="Enter name"
                            disabled={isUpdatingName}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveEditName(user.id);
                              } else if (e.key === 'Escape') {
                                handleCancelEditName();
                              }
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSaveEditName(user.id)}
                            disabled={isUpdatingName}
                            className="p-1 h-6 w-6"
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEditName}
                            disabled={isUpdatingName}
                            className="p-1 h-6 w-6"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h3 className={`font-medium truncate ${
                            (user.unread_count || 0) > 0 ? "font-semibold" : ""
                          }`}>
                            {getDisplayName(user)}
                          </h3>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditName(user);
                            }}
                            className="p-1 h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100"
                            title="Edit name"
                          >
                            <Edit3 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      
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
                      <span className="text-xs text-muted-foreground">
                        {formatTime(user.last_message_time || user.last_active)}
                      </span>
                    {(() => {
                      const ov = statusOverrides[user.id];
                      const statusName = ov?.status_name ?? user.status_name ?? null;
                      const statusColor = ov?.status_color ?? user.status_color ?? null;
                      const isUpdating = updatingStatusFor.has(user.id);

                      return (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-foreground/90 hover:bg-muted/60 transition-colors ${
                                isUpdating ? "opacity-60" : ""
                              }`}
                              title={statusName ? `Status: ${statusName}` : "Set tag"}
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
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
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })()}
                      {(user.unread_count || 0) > 0 && (
                        <div className="bg-green-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium shadow-md animate-scale-in">
                          {user.unread_count! > 99 ? '99+' : user.unread_count}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <p className={`text-sm text-muted-foreground truncate mt-1 ${
                    (user.unread_count || 0) > 0 ? "font-medium text-foreground" : ""
                  }`}>
                    {getMessagePreview(user)}
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