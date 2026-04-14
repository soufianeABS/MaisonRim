"use client";

import { useState, useEffect, useCallback } from "react";
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

interface UnreadConversation {
  conversation_id: string;
  display_name: string;
  unread_count: number;
  last_message_time: string;
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
  const [broadcastGroupId, setBroadcastGroupId] = useState<string | null>(null);
  const [broadcastGroupName, setBroadcastGroupName] = useState<string | null>(null);
  const supabase = createClient();

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
        }));

        setUsers(transformedUsers);

        // On initial load, preload top 10 unread conversations
        if (isInitialLoad) {
          isInitialLoad = false;
          preloadUnreadConversations();
        }
      }
    };

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

    // Set up real-time subscription for messages table changes
    const messagesSubscription = supabase
      .channel('messages-global-channel-optimized')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'messages' 
      }, (payload) => {
        console.log('Messages table change:', payload.eventType);
        
        // Update specific user in list based on message change
        const message = payload.new as MessagePayload;
        if (message) {
          const otherUserId = message.sender_id === user?.id ? message.receiver_id : message.sender_id;
          
          // Update the specific user's last message and unread count
          setUsers((prevUsers) => {
            const updatedUsers = prevUsers.map(u => {
              if (u.id === otherUserId) {
                const isFromMe = isMessageFromCurrentUser(message, user?.id ?? '');
                // Don't increment unread count if this conversation is currently open
                const isCurrentlyViewing = selectedUser?.id === otherUserId;
                const shouldIncrementUnread = !isFromMe && !isCurrentlyViewing;
                
                return {
                  ...u,
                  last_message: message.content || '',
                  last_message_time: message.timestamp,
                  last_message_type: message.message_type || 'text',
                  last_message_sender: message.sender_id,
                  // Increment unread count only if message is from other user and not currently viewing
                  unread_count: shouldIncrementUnread ? (u.unread_count || 0) + 1 : u.unread_count
                };
              }
              return u;
            });
            
            // Re-sort users after update (unread first, then by time)
            return updatedUsers.sort((a, b) => {
              if ((a.unread_count || 0) > 0 && (b.unread_count || 0) === 0) return -1;
              if ((a.unread_count || 0) === 0 && (b.unread_count || 0) > 0) return 1;
              const aTime = new Date(a.last_message_time || a.last_active).getTime();
              const bTime = new Date(b.last_message_time || b.last_active).getTime();
              return bTime - aTime;
            });
          });
        }
        
        // Also debounce a full refresh as fallback
        setTimeout(fetchUsers, 2000);
      })
      .subscribe();

    return () => {
      usersSubscription.unsubscribe();
      messagesSubscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // supabase and selectedUser are stable/controlled

  // Subscribe to messages for selected user with improved real-time handling
  useEffect(() => {
    if (!selectedUser || !user) {
      setMessages([]);
      return;
    }

    const fetchMessages = async () => {
      console.log(`Fetching messages between ${user.id} and ${selectedUser.id}`);
      
      // Use the database function to get conversation messages
      const { data, error } = await supabase.rpc('get_conversation_messages', {
        other_user_id: selectedUser.id
      });
      
      if (error) {
        console.error('Error fetching messages:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        console.error('Selected user ID:', selectedUser.id);
        console.error('Current user ID:', user.id);
      } else {
        console.log(`Fetched ${data?.length || 0} messages`);
        // Map message_timestamp back to timestamp for the interface and ensure is_sent_by_me is set
        const mappedMessages = (data || []).map((msg: MessagePayload & { message_timestamp?: string }) => ({
          ...msg,
          timestamp: msg.message_timestamp || msg.timestamp,
          is_sent_by_me: isMessageFromCurrentUser(msg, user.id),
        }));
        setMessages(mappedMessages);
        
        // Debug: Log first few messages to check is_sent_by_me values
        if (mappedMessages.length > 0) {
          console.log('Sample messages with is_sent_by_me:', mappedMessages.slice(0, 3).map((m: Message) => ({
            id: m.id,
            sender_id: m.sender_id,
            is_sent_by_me: m.is_sent_by_me,
            content: m.content?.substring(0, 20)
          })));
        }
      }
    };

    fetchMessages();

    // Set up real-time subscription for messages with a unique channel name
    const channelName = `messages-${user.id}-${selectedUser.id}-${Date.now()}`;
    const messagesSubscription = supabase
      .channel(channelName)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages'
      }, (payload) => {
        console.log('New message received via real-time:', payload);
        
        const newMessage = payload.new as MessagePayload;
        
        // Messages are stored as: sender_id = contact phone, receiver_id = owner user id (both directions)
        const isRelevantMessage =
          newMessage.receiver_id === user.id &&
          newMessage.sender_id === selectedUser.id;
        
        if (isRelevantMessage) {
          console.log('Adding message to conversation');
          
          const sentByMe = isMessageFromCurrentUser(newMessage, user.id);
          const messageWithFlag: Message = {
            ...newMessage,
            is_sent_by_me: sentByMe,
            timestamp: newMessage.timestamp || new Date().toISOString()
          };
          
          console.log('Real-time message flags:', {
            message_id: messageWithFlag.id,
            sender_id: newMessage.sender_id,
            current_user_id: user.id,
            is_sent_by_me: messageWithFlag.is_sent_by_me,
            content: messageWithFlag.content?.substring(0, 20)
          });
          
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
              fetch('/api/messages/mark-read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otherUserId: selectedUser.id })
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
        console.log('Message updated:', payload);
        
        const updatedMessage = payload.new as MessagePayload;
        
        // Messages are stored as: sender_id = contact phone, receiver_id = owner user id (both directions)
        const isRelevantMessage =
          updatedMessage.receiver_id === user.id &&
          updatedMessage.sender_id === selectedUser.id;
        
        if (isRelevantMessage) {
          const messageWithFlag: Message = {
            ...updatedMessage,
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
        const oldRow = payload.old as { id?: string } | null;
        const deletedId = oldRow?.id;
        if (!deletedId) return;
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
      })
      .subscribe();

    console.log(`Subscribed to messages channel: ${channelName}`);

    return () => {
      console.log(`Unsubscribing from messages channel: ${channelName}`);
      messagesSubscription.unsubscribe();
    };
  }, [selectedUser, user, supabase]);

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

  // Handle user selection and mark messages as read
  const handleUserSelect = async (selectedUser: ChatUser) => {
    console.log('User selected:', selectedUser);
    
    // Clear broadcast group state when selecting an individual user
    setBroadcastGroupId(null);
    setBroadcastGroupName(null);
    
    setSelectedUser(selectedUser);
    
    // Immediately clear unread count in UI for better UX
    if (selectedUser.unread_count && selectedUser.unread_count > 0) {
      setUsers(prev => prev.map(u => 
        u.id === selectedUser.id 
          ? { ...u, unread_count: 0 }
          : u
      ));
      
      // Mark messages as read in the background
      try {
        const response = await fetch('/api/messages/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            otherUserId: selectedUser.id
          }),
        });

        if (response.ok) {
          const result = await response.json();
          console.log(`Marked ${result.markedCount} messages as read`);
        } else {
          console.error('Failed to mark messages as read');
          // Revert unread count if API fails
          setUsers(prev => prev.map(u => 
            u.id === selectedUser.id 
              ? { ...u, unread_count: selectedUser.unread_count }
              : u
          ));
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
        // Revert unread count if API fails
        setUsers(prev => prev.map(u => 
          u.id === selectedUser.id 
            ? { ...u, unread_count: selectedUser.unread_count }
            : u
        ));
      }
    }

    if (!isMobile) {
      setShowChat(true);
    } else {
      setShowChat(true);
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

  const handleSendMessage = async (content: string) => {
    // Check if we're broadcasting to a group or sending to a single user
    if (broadcastGroupId && broadcastGroupName) {
      await handleSendBroadcast(content);
      return;
    }
    
    if (!selectedUser || !user || sendingMessage) return;

    setSendingMessage(true);
    
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
      media_data: null
    };
    
    // Add optimistic message to UI immediately
    setMessages((prev) => [...prev, optimisticMessage]);
    
    try {
      console.log(`Sending message to ${selectedUser.id}: ${content}`);
      
      // Call the WhatsApp API endpoint which handles both WhatsApp sending and database storage
      const response = await fetch('/api/send-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: selectedUser.id,
          message: content,
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
          receiver_id: selectedUser.id,
          content,
          timestamp: new Date().toISOString(),
          message_type: 'text',
          media_data: null
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
      setSendingMessage(false);
    }
  };

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
              Please complete the WhatsApp setup to access the chat interface. 
              You need to configure either the Access Token or Webhook to continue.
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
              onUsersUpdate={refreshUsers}
              onBroadcastToGroup={handleBroadcastToGroup}
            />
          </div>
          
          {/* Chat Window - Desktop */}
          <div className="flex-1">
              <ChatWindow
              selectedUser={selectedUser}
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={sendingMessage}
              onUpdateName={handleUpdateName}
              onUsersUpdate={refreshUsers}
              onMessageDeleted={(id) =>
                id === "__clear_all__"
                  ? setMessages([])
                  : setMessages((prev) => prev.filter((m) => m.id !== id))
              }
              onClose={() => {
                setSelectedUser(null);
                setMessages([]);
                setBroadcastGroupId(null);
                setBroadcastGroupName(null);
              }}
              broadcastGroupName={broadcastGroupName}
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
                onUsersUpdate={refreshUsers}
                onBroadcastToGroup={handleBroadcastToGroup}
              />
      </div>
          ) : (
            // Chat Window - Mobile
            <div className="w-full">
              <ChatWindow
                selectedUser={selectedUser}
                messages={messages}
                onSendMessage={handleSendMessage}
                onMessageDeleted={(id) =>
                  id === "__clear_all__" ? setMessages([]) : setMessages((prev) => prev.filter((m) => m.id !== id))
                }
                onBack={() => {
                  handleBackToUsers();
                  setBroadcastGroupId(null);
                  setBroadcastGroupName(null);
                }}
                isMobile={true}
                isLoading={sendingMessage}
                onUpdateName={handleUpdateName}
                onUsersUpdate={refreshUsers}
                broadcastGroupName={broadcastGroupName}
              />
      </div>
          )}
        </>
      )}
    </div>
  );
}
