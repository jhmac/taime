import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MessageSquare, Users, Megaphone, Send, Plus, ChevronDown, ChevronRight,
  Hash, ArrowLeft, Loader2, UserPlus, PartyPopper, Heart, Star, Trophy, Sparkles, Shield, Smile
} from 'lucide-react';

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const f = firstName?.charAt(0)?.toUpperCase() || '';
  const l = lastName?.charAt(0)?.toUpperCase() || '';
  return f + l || '?';
}

export default function Communication() {
  const { user } = useAuth();
  const { lastMessage } = useWebSocket();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState('team');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [groupMessage, setGroupMessage] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [shoutoutOpen, setShoutoutOpen] = useState(false);
  const [shoutoutRecipient, setShoutoutRecipient] = useState('');
  const [shoutoutCategory, setShoutoutCategory] = useState('');
  const [shoutoutMessage, setShoutoutMessage] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dmEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lastMessage?.type === 'message_created') {
      qc.invalidateQueries({ queryKey: ['/api/messages'] });
      if (selectedGroupId) {
        qc.invalidateQueries({ queryKey: ['/api/groups', selectedGroupId, 'messages'] });
      }
    }
    if (lastMessage?.type === 'shoutout_created') {
      qc.invalidateQueries({ queryKey: ['/api/shoutouts'] });
    }
  }, [lastMessage, qc, selectedGroupId]);

  const { data: groups = [], isLoading: groupsLoading } = useQuery<any[]>({
    queryKey: ['/api/groups'],
  });

  const { data: groupMessages = [], isLoading: groupMessagesLoading } = useQuery<any[]>({
    queryKey: ['/api/groups', selectedGroupId, 'messages'],
    enabled: !!selectedGroupId,
  });

  const { data: groupMembers = [] } = useQuery<any[]>({
    queryKey: ['/api/groups', selectedGroupId, 'members'],
    enabled: !!selectedGroupId,
  });

  const { data: allMessages = [], isLoading: messagesLoading } = useQuery<any[]>({
    queryKey: ['/api/messages'],
  });

  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ['/api/users'],
  });

  const { data: shoutoutsList = [], isLoading: shoutoutsLoading } = useQuery<any[]>({
    queryKey: ['/api/shoutouts'],
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [groupMessages]);

  useEffect(() => {
    dmEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages, selectedUserId]);

  const handleMutationError = (error: Error) => {
    if (isUnauthorizedError(error)) {
      toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
      setTimeout(() => { window.location.href = "/api/login"; }, 500);
      return;
    }
    toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
  };

  const sendGroupMessageMutation = useMutation({
    mutationFn: async (data: { content: string; groupId: string }) => {
      return await apiRequest('POST', '/api/messages', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/groups', selectedGroupId, 'messages'] });
      setGroupMessage('');
    },
    onError: handleMutationError,
  });

  const sendDirectMessageMutation = useMutation({
    mutationFn: async (data: { content: string; recipientId: string }) => {
      return await apiRequest('POST', '/api/messages', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/messages'] });
      setDirectMessage('');
    },
    onError: handleMutationError,
  });

  const sendAnnouncementMutation = useMutation({
    mutationFn: async (data: { content: string; isAnnouncement: boolean }) => {
      return await apiRequest('POST', '/api/messages', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/messages'] });
      setAnnouncementContent('');
      toast({ title: "Announcement sent", description: "Your announcement has been posted." });
    },
    onError: handleMutationError,
  });

  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; memberIds: string[] }) => {
      return await apiRequest('POST', '/api/groups', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/groups'] });
      setCreateGroupOpen(false);
      setNewGroupName('');
      setNewGroupDescription('');
      setSelectedMemberIds([]);
      toast({ title: "Group created", description: "Your new group has been created." });
    },
    onError: handleMutationError,
  });

  const SHOUTOUT_CATEGORIES = [
    { value: 'great_attitude', label: 'Great Attitude', emoji: '✌️', color: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700' },
    { value: 'team_player', label: 'Team Player', emoji: '🤝', color: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' },
    { value: 'above_and_beyond', label: 'Above & Beyond', emoji: '🚀', color: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700' },
    { value: 'problem_solver', label: 'Problem Solver', emoji: '💡', color: 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700' },
    { value: 'customer_hero', label: 'Customer Hero', emoji: '⭐', color: 'bg-rose-100 dark:bg-rose-900/30 border-rose-300 dark:border-rose-700' },
    { value: 'quick_learner', label: 'Quick Learner', emoji: '📚', color: 'bg-cyan-100 dark:bg-cyan-900/30 border-cyan-300 dark:border-cyan-700' },
    { value: 'great_communicator', label: 'Great Communicator', emoji: '💬', color: 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700' },
    { value: 'reliability', label: 'Reliability', emoji: '🛡️', color: 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700' },
  ];

  const getCategoryInfo = (value: string) => SHOUTOUT_CATEGORIES.find(c => c.value === value) || SHOUTOUT_CATEGORIES[0];

  const sendShoutoutMutation = useMutation({
    mutationFn: async (data: { recipientId: string; category: string; message: string; emoji?: string }) => {
      return await apiRequest('POST', '/api/shoutouts', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/shoutouts'] });
      setShoutoutOpen(false);
      setShoutoutRecipient('');
      setShoutoutCategory('');
      setShoutoutMessage('');
      toast({ title: "Shoutout sent!", description: "Your recognition has been shared with the team." });
    },
    onError: handleMutationError,
  });

  const reactToShoutoutMutation = useMutation({
    mutationFn: async ({ id, emoji }: { id: string; emoji: string }) => {
      return await apiRequest('POST', `/api/shoutouts/${id}/react`, { emoji });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/shoutouts'] });
    },
    onError: handleMutationError,
  });

  const handleSendShoutout = () => {
    if (!shoutoutRecipient || !shoutoutCategory || !shoutoutMessage.trim()) return;
    const cat = getCategoryInfo(shoutoutCategory);
    sendShoutoutMutation.mutate({
      recipientId: shoutoutRecipient,
      category: shoutoutCategory,
      message: shoutoutMessage,
      emoji: cat.emoji,
    });
  };

  const handleSendGroupMessage = () => {
    if (!groupMessage.trim() || !selectedGroupId) return;
    sendGroupMessageMutation.mutate({ content: groupMessage, groupId: selectedGroupId });
  };

  const handleSendDirectMessage = () => {
    if (!directMessage.trim() || !selectedUserId) return;
    sendDirectMessageMutation.mutate({ content: directMessage, recipientId: selectedUserId });
  };

  const handleSendAnnouncement = () => {
    if (!announcementContent.trim()) return;
    sendAnnouncementMutation.mutate({ content: announcementContent, isAnnouncement: true });
  };

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    createGroupMutation.mutate({ name: newGroupName, description: newGroupDescription, memberIds: selectedMemberIds });
  };

  const toggleMember = (id: string) => {
    setSelectedMemberIds(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const getUserName = (userId: string) => {
    const u = allUsers.find((u: any) => u.id === userId);
    return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown' : 'Unknown';
  };

  const getUserInitials = (userId: string) => {
    const u = allUsers.find((u: any) => u.id === userId);
    return getInitials(u?.firstName, u?.lastName);
  };

  const announcements = allMessages.filter((m: any) => m.isAnnouncement);
  const directMessages = allMessages.filter((m: any) => !m.isAnnouncement && !m.groupId);

  const dmConversations = (() => {
    const convMap = new Map<string, any>();
    directMessages.forEach((msg: any) => {
      const otherId = msg.senderId === user?.id ? msg.recipientId : msg.senderId;
      if (!otherId) return;
      const existing = convMap.get(otherId);
      if (!existing || new Date(msg.createdAt) > new Date(existing.createdAt)) {
        convMap.set(otherId, msg);
      }
    });
    return Array.from(convMap.entries()).map(([userId, lastMsg]) => ({
      userId,
      lastMessage: lastMsg,
      name: getUserName(userId),
      initials: getUserInitials(userId),
    })).sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());
  })();

  const selectedDmMessages = selectedUserId
    ? directMessages.filter((m: any) =>
        (m.senderId === user?.id && m.recipientId === selectedUserId) ||
        (m.senderId === selectedUserId && m.recipientId === user?.id)
      ).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];

  const selectedGroup = groups.find((g: any) => g.id === selectedGroupId);

  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="px-4 pt-4 pb-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="team" className="gap-1.5">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Team Chat</span>
              <span className="sm:hidden">Team</span>
            </TabsTrigger>
            <TabsTrigger value="direct" className="gap-1.5">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Direct Messages</span>
              <span className="sm:hidden">DMs</span>
            </TabsTrigger>
            <TabsTrigger value="celebrations" className="gap-1.5">
              <PartyPopper className="h-4 w-4" />
              <span className="hidden sm:inline">Celebrations</span>
              <span className="sm:hidden">Celebrate</span>
            </TabsTrigger>
            <TabsTrigger value="announcements" className="gap-1.5">
              <Megaphone className="h-4 w-4" />
              <span className="hidden sm:inline">Announcements</span>
              <span className="sm:hidden">News</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="team" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <div className="flex h-full gap-3">
            <div className={`${selectedGroupId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 shrink-0`}>
              <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold">Groups</CardTitle>
                  <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create Group</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label>Group Name</Label>
                          <Input
                            placeholder="e.g. Morning Crew"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label>Description</Label>
                          <Input
                            placeholder="Optional description"
                            value={newGroupDescription}
                            onChange={(e) => setNewGroupDescription(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label>Add Members</Label>
                          <ScrollArea className="h-48 border rounded-md p-2 mt-1">
                            {allUsers
                              .filter((u: any) => u.id !== user?.id)
                              .map((u: any) => (
                                <div key={u.id} className="flex items-center space-x-2 py-1.5">
                                  <Checkbox
                                    id={`member-${u.id}`}
                                    checked={selectedMemberIds.includes(u.id)}
                                    onCheckedChange={() => toggleMember(u.id)}
                                  />
                                  <label htmlFor={`member-${u.id}`} className="text-sm cursor-pointer flex items-center gap-2">
                                    <Avatar className="h-6 w-6">
                                      <AvatarFallback className="text-xs">{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                    </Avatar>
                                    {u.firstName} {u.lastName}
                                  </label>
                                </div>
                              ))}
                          </ScrollArea>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button onClick={handleCreateGroup} disabled={!newGroupName.trim() || createGroupMutation.isPending}>
                          {createGroupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Create Group
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <div className="px-2 pb-2">
                    {groupsLoading ? (
                      <div className="space-y-2 p-2">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full rounded-lg" />
                        ))}
                      </div>
                    ) : groups.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No groups yet</p>
                        <p className="text-xs mt-1">Create one to get started</p>
                      </div>
                    ) : (
                      groups.map((group: any) => (
                        <button
                          key={group.id}
                          onClick={() => setSelectedGroupId(group.id)}
                          className={`w-full text-left p-3 rounded-lg mb-1 transition-colors flex items-center gap-3 ${
                            selectedGroupId === group.id
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Hash className="h-4 w-4 text-primary" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="font-medium text-sm truncate">{group.name}</p>
                            {group.description && (
                              <p className="text-xs text-muted-foreground truncate">{group.description}</p>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </Card>
            </div>

            <div className={`${selectedGroupId ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
              {selectedGroupId && selectedGroup ? (
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardHeader className="py-3 px-4 border-b space-y-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 md:hidden shrink-0"
                        onClick={() => setSelectedGroupId(null)}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Hash className="h-4 w-4 text-primary shrink-0" />
                      <CardTitle className="text-sm font-semibold truncate">{selectedGroup.name}</CardTitle>
                      <div className="ml-auto">
                        <Collapsible open={showMembers} onOpenChange={setShowMembers}>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs">
                              <UserPlus className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">{groupMembers.length} members</span>
                              {showMembers ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </Button>
                          </CollapsibleTrigger>
                        </Collapsible>
                      </div>
                    </div>
                    <Collapsible open={showMembers} onOpenChange={setShowMembers}>
                      <CollapsibleContent>
                        <div className="flex flex-wrap gap-2 pt-2">
                          {groupMembers.map((member: any) => (
                            <Badge key={member.id} variant="secondary" className="gap-1">
                              <Avatar className="h-4 w-4">
                                <AvatarFallback className="text-[8px]">{getUserInitials(member.userId)}</AvatarFallback>
                              </Avatar>
                              {getUserName(member.userId)}
                            </Badge>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardHeader>
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {groupMessagesLoading ? (
                        <div className="space-y-3">
                          {[...Array(3)].map((_, i) => (
                            <div key={i} className="flex gap-3">
                              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                              <div className="space-y-1 flex-1">
                                <Skeleton className="h-3 w-20" />
                                <Skeleton className="h-10 w-3/4 rounded-lg" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : groupMessages.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                          <p className="text-sm">No messages yet</p>
                          <p className="text-xs mt-1">Start the conversation!</p>
                        </div>
                      ) : (
                        groupMessages.map((msg: any) => {
                          const isMine = msg.senderId === user?.id;
                          return (
                            <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                              {!isMine && (
                                <Avatar className="h-8 w-8 shrink-0">
                                  <AvatarFallback className="text-xs">{getUserInitials(msg.senderId)}</AvatarFallback>
                                </Avatar>
                              )}
                              <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                                {!isMine && (
                                  <span className="text-xs text-muted-foreground mb-0.5 px-1">{getUserName(msg.senderId)}</span>
                                )}
                                <div className={`rounded-2xl px-3 py-2 text-sm ${
                                  isMine
                                    ? 'bg-primary text-primary-foreground rounded-br-md'
                                    : 'bg-muted rounded-bl-md'
                                }`}>
                                  {msg.content}
                                </div>
                                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>
                  <div className="p-3 border-t">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={groupMessage}
                        onChange={(e) => setGroupMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendGroupMessage()}
                      />
                      <Button
                        size="icon"
                        onClick={handleSendGroupMessage}
                        disabled={!groupMessage.trim() || sendGroupMessageMutation.isPending}
                      >
                        {sendGroupMessageMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <Hash className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Select a group</p>
                    <p className="text-sm mt-1">Choose a group from the sidebar to start chatting</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="direct" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <div className="flex h-full gap-3">
            <div className={`${selectedUserId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 shrink-0`}>
              <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm font-semibold">Conversations</CardTitle>
                </CardHeader>
                <ScrollArea className="flex-1">
                  <div className="px-2 pb-2">
                    {messagesLoading ? (
                      <div className="space-y-2 p-2">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-14 w-full rounded-lg" />
                        ))}
                      </div>
                    ) : dmConversations.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No conversations yet</p>
                        <p className="text-xs mt-1">Select a team member below to start</p>
                        <div className="mt-4 space-y-1">
                          {allUsers
                            .filter((u: any) => u.id !== user?.id)
                            .slice(0, 5)
                            .map((u: any) => (
                              <button
                                key={u.id}
                                onClick={() => setSelectedUserId(u.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-muted flex items-center gap-2"
                              >
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-xs">{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                </Avatar>
                                <span className="text-sm">{u.firstName} {u.lastName}</span>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        {dmConversations.map((conv) => (
                          <button
                            key={conv.userId}
                            onClick={() => setSelectedUserId(conv.userId)}
                            className={`w-full text-left p-3 rounded-lg mb-1 transition-colors flex items-center gap-3 ${
                              selectedUserId === conv.userId
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-muted'
                            }`}
                          >
                            <Avatar className="h-9 w-9 shrink-0">
                              <AvatarFallback className="text-xs">{conv.initials}</AvatarFallback>
                            </Avatar>
                            <div className="overflow-hidden flex-1">
                              <p className="font-medium text-sm truncate">{conv.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{conv.lastMessage.content}</p>
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </button>
                        ))}
                        <div className="border-t mt-2 pt-2">
                          <p className="text-xs text-muted-foreground px-2 mb-1">Start new conversation</p>
                          {allUsers
                            .filter((u: any) => u.id !== user?.id && !dmConversations.find(c => c.userId === u.id))
                            .map((u: any) => (
                              <button
                                key={u.id}
                                onClick={() => setSelectedUserId(u.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-muted flex items-center gap-2"
                              >
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-xs">{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                </Avatar>
                                <span className="text-sm">{u.firstName} {u.lastName}</span>
                              </button>
                            ))}
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              </Card>
            </div>

            <div className={`${selectedUserId ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
              {selectedUserId ? (
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardHeader className="py-3 px-4 border-b space-y-0">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 md:hidden shrink-0"
                        onClick={() => setSelectedUserId(null)}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="text-xs">{getUserInitials(selectedUserId)}</AvatarFallback>
                      </Avatar>
                      <CardTitle className="text-sm font-semibold">{getUserName(selectedUserId)}</CardTitle>
                    </div>
                  </CardHeader>
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {selectedDmMessages.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                          <p className="text-sm">No messages yet</p>
                          <p className="text-xs mt-1">Say hello!</p>
                        </div>
                      ) : (
                        selectedDmMessages.map((msg: any) => {
                          const isMine = msg.senderId === user?.id;
                          return (
                            <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                              {!isMine && (
                                <Avatar className="h-8 w-8 shrink-0">
                                  <AvatarFallback className="text-xs">{getUserInitials(msg.senderId)}</AvatarFallback>
                                </Avatar>
                              )}
                              <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                                <div className={`rounded-2xl px-3 py-2 text-sm ${
                                  isMine
                                    ? 'bg-primary text-primary-foreground rounded-br-md'
                                    : 'bg-muted rounded-bl-md'
                                }`}>
                                  {msg.content}
                                </div>
                                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={dmEndRef} />
                    </div>
                  </ScrollArea>
                  <div className="p-3 border-t">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={directMessage}
                        onChange={(e) => setDirectMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendDirectMessage()}
                      />
                      <Button
                        size="icon"
                        onClick={handleSendDirectMessage}
                        disabled={!directMessage.trim() || sendDirectMessageMutation.isPending}
                      >
                        {sendDirectMessageMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="flex-1 flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Select a conversation</p>
                    <p className="text-sm mt-1">Choose a contact to start messaging</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="celebrations" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 border-b space-y-0 flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <PartyPopper className="h-4 w-4 text-primary" />
                Celebrations
              </CardTitle>
              <Dialog open={shoutoutOpen} onOpenChange={setShoutoutOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    Give Shoutout
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <PartyPopper className="h-5 w-5" />
                      Give a Shoutout
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm mb-1.5 block">Who are you recognizing?</Label>
                      <Select value={shoutoutRecipient} onValueChange={setShoutoutRecipient}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a team member" />
                        </SelectTrigger>
                        <SelectContent>
                          {allUsers
                            .filter((u: any) => u.id !== user?.id && u.isActive !== false)
                            .map((u: any) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.firstName} {u.lastName}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">Category</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {SHOUTOUT_CATEGORIES.map(cat => (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() => setShoutoutCategory(cat.value)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                              shoutoutCategory === cat.value
                                ? `${cat.color} ring-2 ring-primary font-medium`
                                : 'bg-muted/30 border-border hover:bg-muted/60'
                            }`}
                          >
                            <span className="text-lg">{cat.emoji}</span>
                            <span>{cat.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">Message</Label>
                      <Textarea
                        placeholder="What did they do that was awesome?"
                        value={shoutoutMessage}
                        onChange={e => setShoutoutMessage(e.target.value)}
                        className="min-h-20"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleSendShoutout}
                      disabled={!shoutoutRecipient || !shoutoutCategory || !shoutoutMessage.trim() || sendShoutoutMutation.isPending}
                      className="w-full gap-2"
                    >
                      {sendShoutoutMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      Send Shoutout
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {shoutoutsLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-32 w-full rounded-lg" />
                    ))}
                  </div>
                ) : shoutoutsList.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <PartyPopper className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No shoutouts yet</p>
                    <p className="text-sm mt-1">Be the first to recognize a team member!</p>
                  </div>
                ) : (
                  shoutoutsList.map((s: any) => {
                    const cat = getCategoryInfo(s.category);
                    const reactions = (s.reactions || []) as Array<{ userId: string; emoji: string }>;
                    const heartCount = reactions.filter((r: any) => r.emoji === '❤️').length;
                    const userHearted = reactions.some((r: any) => r.userId === user?.id && r.emoji === '❤️');
                    return (
                      <div key={s.id} className="rounded-lg border overflow-hidden">
                        <div className="p-4 bg-muted/20">
                          <p className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                            Shoutout to {getUserName(s.recipientId)}!
                          </p>
                          <div className={`rounded-lg border p-4 ${cat.color}`}>
                            <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <p className="font-bold text-sm">{cat.label}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {new Date(s.createdAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                </p>
                                <p className="text-sm mt-2">{s.message}</p>
                              </div>
                              <span className="text-3xl">{cat.emoji}</span>
                            </div>
                          </div>
                        </div>
                        <div className="px-4 py-2 border-t flex items-center justify-between bg-background">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className="text-[10px] bg-primary/10">
                                {getUserInitials(s.senderId)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs text-muted-foreground">
                              {getUserName(s.senderId)} &middot; {new Date(s.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <button
                            onClick={() => reactToShoutoutMutation.mutate({ id: s.id, emoji: '❤️' })}
                            className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
                              userHearted 
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' 
                                : 'hover:bg-muted text-muted-foreground'
                            }`}
                          >
                            <Heart className={`h-3.5 w-3.5 ${userHearted ? 'fill-red-500 text-red-500' : ''}`} />
                            {heartCount > 0 && <span>{heartCount}</span>}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="announcements" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 border-b space-y-0 flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-primary" />
                Announcements
              </CardTitle>
              {(user as any)?.role?.name === 'admin' || (user as any)?.roleId ? (
                <Badge variant="outline" className="text-xs">Admin</Badge>
              ) : null}
            </CardHeader>

            {(user as any)?.role?.name === 'admin' && (
              <div className="p-4 border-b">
                <Textarea
                  placeholder="Write an announcement..."
                  value={announcementContent}
                  onChange={(e) => setAnnouncementContent(e.target.value)}
                  className="min-h-20 mb-2"
                />
                <Button
                  onClick={handleSendAnnouncement}
                  disabled={!announcementContent.trim() || sendAnnouncementMutation.isPending}
                  className="w-full"
                >
                  {sendAnnouncementMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Megaphone className="h-4 w-4 mr-2" />
                  )}
                  Post Announcement
                </Button>
              </div>
            )}

            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messagesLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full rounded-lg" />
                    ))}
                  </div>
                ) : announcements.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No announcements yet</p>
                  </div>
                ) : (
                  announcements
                    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((msg: any) => (
                      <div key={msg.id} className="p-4 bg-muted/40 rounded-lg border">
                        <div className="flex items-start gap-3">
                          <Avatar className="h-9 w-9 shrink-0">
                            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                              {getUserInitials(msg.senderId)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-medium text-sm">{getUserName(msg.senderId)}</p>
                              <span className="text-xs text-muted-foreground">
                                {new Date(msg.createdAt).toLocaleDateString()} {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </ScrollArea>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
