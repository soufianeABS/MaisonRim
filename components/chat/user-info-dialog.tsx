"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Edit3, Check, Phone, MessageCircle, Clock, User, Tag } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

interface ChatUser {
  id: string;
  name: string;
  custom_name?: string;
  whatsapp_name?: string;
  avatar_url?: string | null;
  last_active: string;
  unread_count?: number;
  last_message_time?: string;
  status_id?: string | null;
  status_name?: string | null;
  status_color?: string | null;
  status_rule?: string | null;
}

interface UserInfoDialogProps {
  user: ChatUser;
  isOpen: boolean;
  onClose: () => void;
  onUpdateName: (userId: string, customName: string) => Promise<void>;
  onUsersUpdate?: () => void;
}

type ContactStatus = {
  id: string;
  name: string;
  color: string;
  rule: string;
};

export function UserInfoDialog({
  user,
  isOpen,
  onClose,
  onUpdateName,
  onUsersUpdate,
}: UserInfoDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(user.custom_name || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [statuses, setStatuses] = useState<ContactStatus[]>([]);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [localStatusName, setLocalStatusName] = useState<string | null>(
    user.status_name ?? null,
  );
  const [localStatusColor, setLocalStatusColor] = useState<string | null>(
    user.status_color ?? null,
  );
  const [localStatusRule, setLocalStatusRule] = useState<string | null>(
    user.status_rule ?? null,
  );

  // Keep local status snapshot in sync when switching users
  // (dialog is re-used by the parent)
  useEffect(() => {
    setEditingName(user.custom_name || "");
    setLocalStatusName(user.status_name ?? null);
    setLocalStatusColor(user.status_color ?? null);
    setLocalStatusRule(user.status_rule ?? null);
  }, [
    user.custom_name,
    user.status_name,
    user.status_color,
    user.status_rule,
    user.id,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    // lazy load statuses for the dropdown
    const load = async () => {
      setStatusesLoading(true);
      try {
        const res = await fetch("/api/contact-statuses");
        const data = await res.json();
        if (res.ok) {
          setStatuses(data.statuses ?? []);
        }
      } finally {
        setStatusesLoading(false);
      }
    };
    void load();
  }, [isOpen]);

  const getDisplayName = () => {
    return user.custom_name || user.whatsapp_name || user.id;
  };

  const statusPreview =
    localStatusName && localStatusColor
      ? { name: localStatusName, color: localStatusColor }
      : null;

  if (!isOpen) return null;

  const formatLastActive = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.abs(now.getTime() - date.getTime()) / (1000 * 60);
    
    if (diffInMinutes < 1) {
      return "Just now";
    } else if (diffInMinutes < 60) {
      return `${Math.floor(diffInMinutes)} minutes ago`;
    } else if (diffInMinutes < 1440) { // 24 hours
      const hours = Math.floor(diffInMinutes / 60);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(diffInMinutes / 1440);
      if (days < 7) {
        return `${days} day${days !== 1 ? 's' : ''} ago`;
      } else {
        return date.toLocaleDateString([], { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
  };

  const handleSaveName = async () => {
    if (isUpdating) return;
    
    setIsUpdating(true);
    try {
      await onUpdateName(user.id, editingName.trim());
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating name:', error);
      // Reset to original name on error
      setEditingName(user.custom_name || '');
    } finally {
      setIsUpdating(false);
    }
  };

  const setContactStatus = async (statusId: string | null) => {
    if (statusSaving) return;
    setStatusSaving(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(user.id)}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_id: statusId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to set status");
      }

      const chosen = statuses.find((s) => s.id === statusId) ?? null;
      setLocalStatusName(chosen?.name ?? null);
      setLocalStatusColor(chosen?.color ?? null);
      setLocalStatusRule(chosen?.rule ?? null);

      await onUsersUpdate?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to set status");
    } finally {
      setStatusSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingName(user.custom_name || '');
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setEditingName(user.custom_name || '');
    setIsEditing(true);
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Dialog */}
        <div 
          className="bg-background rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-semibold">Contact Info</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-full"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Avatar and Name Section */}
            <div className="flex flex-col items-center text-center space-y-4">
              <Avatar className="h-24 w-24">
                {user.avatar_url ? (
                  <AvatarImage
                    src={user.avatar_url}
                    alt={getDisplayName()}
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                <AvatarFallback className="bg-green-100 text-green-700 font-semibold text-2xl">
                  {getDisplayName().charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              {/* Name Editing */}
              <div className="w-full space-y-2">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder="Enter custom name"
                      className="text-center"
                      disabled={isUpdating}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveName();
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveName}
                      disabled={isUpdating}
                      className="bg-green-600 hover:bg-green-700 text-white px-3"
                    >
                      {isUpdating ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancelEdit}
                      disabled={isUpdating}
                      className="px-3"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="text-2xl font-semibold">{getDisplayName()}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleStartEdit}
                      className="p-1 hover:bg-muted rounded-full"
                      title="Edit name"
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Information Cards */}
            <div className="space-y-4">
              {/* Status */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                <Tag className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {statusPreview ? (
                      <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: statusPreview.color }}
                        />
                        {statusPreview.name}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">None</span>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={statusesLoading || statusSaving}
                        >
                          {statusSaving ? "Saving…" : "Change"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                          {statusesLoading ? "Loading…" : "Choose a status"}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => void setContactStatus(null)}
                          disabled={statusSaving}
                        >
                          Clear status
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {statuses.map((s) => (
                          <DropdownMenuItem
                            key={s.id}
                            onSelect={() => void setContactStatus(s.id)}
                            disabled={statusSaving}
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full mr-2"
                              style={{ backgroundColor: s.color }}
                            />
                            {s.name}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <a href="/protected/statuses">Manage statuses…</a>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {localStatusRule?.trim() ? (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-muted-foreground">Rule</p>
                      <Textarea
                        value={localStatusRule}
                        readOnly
                        rows={3}
                        className="mt-1 text-xs resize-y"
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Phone Number */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                <Phone className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">Phone Number</p>
                  <p className="text-base font-mono">{user.id}</p>
                </div>
              </div>

              {/* WhatsApp Name */}
              {user.whatsapp_name && user.whatsapp_name !== user.id && (
                <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                  <MessageCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-muted-foreground">WhatsApp Name</p>
                    <p className="text-base">{user.whatsapp_name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This name comes from their WhatsApp profile
                    </p>
                  </div>
                </div>
              )}

              {/* Custom Name */}
              {user.custom_name && (
                <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                  <User className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-muted-foreground">Custom Name</p>
                    <p className="text-base">{user.custom_name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This is the name you&apos;ve set for this contact
                    </p>
                  </div>
                </div>
              )}

              {/* Last Active */}
              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">Last Active</p>
                  <p className="text-base">{formatLastActive(user.last_active)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(user.last_active).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={onClose}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
} 