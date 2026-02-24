import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
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
import { format } from 'date-fns';
import {
  MessageSquare, Users, Megaphone, Send, Plus, ChevronDown, ChevronRight,
  Hash, ArrowLeft, Loader2, UserPlus, PartyPopper, Heart, Star, Trophy, Sparkles, Shield, Smile, Quote
} from 'lucide-react';

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const f = firstName?.charAt(0)?.toUpperCase() || '';
  const l = lastName?.charAt(0)?.toUpperCase() || '';
  return f + l || '?';
}

function RocketIcon(props: Record<string, unknown>) {
  return <PartyPopper {...props} />;
}

const SHOUTOUT_CATEGORIES = [
  { value: 'great_attitude', label: 'Great Attitude', emoji: '✌️', color: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700', icon: Smile },
  { value: 'team_player', label: 'Team Player', emoji: '🤝', color: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700', icon: Users },
  { value: 'above_and_beyond', label: 'Above & Beyond', emoji: '🚀', color: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700', icon: RocketIcon },
  { value: 'problem_solver', label: 'Problem Solver', emoji: '💡', color: 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700', icon: Sparkles },
  { value: 'customer_hero', label: 'Customer Hero', emoji: '⭐', color: 'bg-rose-100 dark:bg-rose-900/30 border-rose-300 dark:border-rose-700', icon: Trophy },
  { value: 'quick_learner', label: 'Quick Learner', emoji: '📚', color: 'bg-cyan-100 dark:bg-cyan-900/30 border-cyan-300 dark:border-cyan-700', icon: Star },
  { value: 'great_communicator', label: 'Great Communicator', emoji: '💬', color: 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700', icon: MessageSquare },
  { value: 'reliability', label: 'Reliability', emoji: '🛡️', color: 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700', icon: Shield },
] as const;

function getCategoryInfo(value: string) {
  return SHOUTOUT_CATEGORIES.find(c => c.value === value) || SHOUTOUT_CATEGORIES[0];
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
    if (lastMessage?.type === 'shoutout_reaction') {
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

  const { data: settings } = useQuery<any>({
    queryKey: ['/api/company-settings'],
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

  const userMap = useMemo(() => {
    const map = new Map<string, { name: string; initials: string }>();
    allUsers.forEach((u: any) => {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown';
      map.set(u.id, { name, initials: getInitials(u.firstName, u.lastName) });
    });
    return map;
  }, [allUsers]);

  const getUserName = (userId: string) => userMap.get(userId)?.name || 'Unknown';
  const getUserInitials = (userId: string) => userMap.get(userId)?.initials || '?';

  const announcements = allMessages.filter((m: any) => m.isAnnouncement);
  const directMessages = allMessages.filter((m: any) => !m.isAnnouncement && !m.groupId);

  const dmConversations = useMemo(() => {
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
  }, [directMessages, allUsers, user?.id]);

  const selectedDmMessages = useMemo(() => {
    if (!selectedUserId) return [];
    return directMessages.filter((m: any) =>
      (m.senderId === user?.id && m.recipientId === selectedUserId) ||
      (m.senderId === selectedUserId && m.recipientId === user?.id)
    ).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [directMessages, selectedUserId, user?.id]);

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
                                  {format(new Date(msg.createdAt), 'h:mm a')}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>
                  <div className="p-3 border-t bg-muted/30">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={groupMessage}
                        onChange={(e) => setGroupMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendGroupMessage()}
                        disabled={sendGroupMessageMutation.isPending}
                      />
                      <Button size="icon" onClick={handleSendGroupMessage} disabled={!groupMessage.trim() || sendGroupMessageMutation.isPending}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-muted/20 rounded-lg border-2 border-dashed">
                  <div className="text-center space-y-2">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <Hash className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold">Select a group</h3>
                    <p className="text-sm text-muted-foreground">Choose a group from the sidebar to start chatting</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="direct" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <div className="flex h-full gap-3">
            <div className={`${selectedUserId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-72 shrink-0`}>
              <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm font-semibold">Messages</CardTitle>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>New Message</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="h-72 pr-4">
                        <div className="space-y-1">
                          {allUsers
                            .filter((u: any) => u.id !== user?.id)
                            .map((u: any) => (
                              <button
                                key={u.id}
                                onClick={() => {
                                  setSelectedUserId(u.id);
                                  toast({ title: "Conversation started", description: `You can now chat with ${u.firstName}` });
                                }}
                                className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3 transition-colors"
                              >
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback>{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                                  <p className="text-xs text-muted-foreground">{u.roleName || 'Team Member'}</p>
                                </div>
                              </button>
                            ))}
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
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
                        <p>No direct messages</p>
                        <p className="text-xs mt-1">Start a conversation!</p>
                      </div>
                    ) : (
                      dmConversations.map((conv) => (
                        <button
                          key={conv.userId}
                          onClick={() => setSelectedUserId(conv.userId)}
                          className={`w-full text-left p-3 rounded-lg mb-1 transition-colors flex items-center gap-3 ${
                            selectedUserId === conv.userId
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <Avatar className="h-10 w-10 shrink-0 border">
                            <AvatarFallback>{conv.initials}</AvatarFallback>
                          </Avatar>
                          <div className="overflow-hidden flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <p className="font-medium text-sm truncate">{conv.name}</p>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {format(new Date(conv.lastMessage.createdAt), 'h:mm a')}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {conv.lastMessage.senderId === user?.id ? 'You: ' : ''}
                              {conv.lastMessage.content}
                            </p>
                          </div>
                        </button>
                      ))
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
                        <AvatarFallback>{getUserInitials(selectedUserId)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-sm font-semibold truncate">{getUserName(selectedUserId)}</CardTitle>
                        <p className="text-[10px] text-muted-foreground">Active now</p>
                      </div>
                    </div>
                  </CardHeader>
                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {selectedDmMessages.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                          <p className="text-sm">No messages yet</p>
                          <p className="text-xs mt-1">Send a message to start the conversation!</p>
                        </div>
                      ) : (
                        selectedDmMessages.map((msg: any) => {
                          const isMine = msg.senderId === user?.id;
                          return (
                            <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                              <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                                <div className={`rounded-2xl px-3 py-2 text-sm ${
                                  isMine
                                    ? 'bg-primary text-primary-foreground rounded-br-md'
                                    : 'bg-muted rounded-bl-md'
                                }`}>
                                  {msg.content}
                                </div>
                                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                                  {format(new Date(msg.createdAt), 'h:mm a')}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                      <div ref={dmEndRef} />
                    </div>
                  </ScrollArea>
                  <div className="p-3 border-t bg-muted/30">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={directMessage}
                        onChange={(e) => setDirectMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendDirectMessage()}
                        disabled={sendDirectMessageMutation.isPending}
                      />
                      <Button size="icon" onClick={handleSendDirectMessage} disabled={!directMessage.trim() || sendDirectMessageMutation.isPending}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-muted/20 rounded-lg border-2 border-dashed">
                  <div className="text-center space-y-2">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <MessageSquare className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-semibold">Direct Messages</h3>
                    <p className="text-sm text-muted-foreground">Select a teammate to start a private conversation</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="celebrations" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <Card className="h-full flex flex-col overflow-hidden border-none shadow-none bg-transparent">
            <CardHeader className="px-0 pt-0 pb-4 flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xl font-bold flex items-center gap-2">
                  <PartyPopper className="h-6 w-6 text-primary" />
                  Team Celebrations
                </CardTitle>
                <p className="text-sm text-muted-foreground">Recognize your teammates for their hard work!</p>
              </div>
              {settings?.allowShoutOuts !== false && (
                <Dialog open={shoutoutOpen} onOpenChange={setShoutoutOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Star className="h-4 w-4" />
                      Give Shoutout
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <PartyPopper className="h-5 w-5 text-primary" />
                        Recognize a Teammate
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Who are you recognizing?</Label>
                        <Select value={shoutoutRecipient} onValueChange={setShoutoutRecipient}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select teammate..." />
                          </SelectTrigger>
                          <SelectContent>
                            {allUsers
                              .filter((u: any) => u.id !== user?.id)
                              .map((u: any) => (
                                <SelectItem key={u.id} value={u.id}>
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-5 w-5">
                                      <AvatarFallback className="text-[10px]">{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                                    </Avatar>
                                    {u.firstName} {u.lastName}
                                  </div>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {SHOUTOUT_CATEGORIES.map((cat) => (
                            <Button
                              key={cat.value}
                              variant={shoutoutCategory === cat.value ? 'default' : 'outline'}
                              className={`h-auto py-2 flex-col gap-1 items-center justify-center text-center px-1 ${
                                shoutoutCategory === cat.value ? '' : 'hover:bg-muted'
                              }`}
                              onClick={() => setShoutoutCategory(cat.value)}
                            >
                              <span className="text-xl">{cat.emoji}</span>
                              <span className="text-[10px] leading-tight">{cat.label}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Your message</Label>
                        <Textarea
                          placeholder="What did they do that was awesome?"
                          className="min-h-[100px] resize-none"
                          value={shoutoutMessage}
                          onChange={(e) => setShoutoutMessage(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        className="w-full"
                        onClick={handleSendShoutout}
                        disabled={!shoutoutRecipient || !shoutoutCategory || !shoutoutMessage.trim() || sendShoutoutMutation.isPending}
                      >
                        {sendShoutoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Send Celebration!
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <ScrollArea className="flex-1 -mx-4 px-4">
              <div className="space-y-6 pb-6">
                {shoutoutsLoading ? (
                  <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-48 w-full rounded-xl" />
                    ))}
                  </div>
                ) : shoutoutsList.length === 0 ? (
                  <div className="text-center py-20 bg-muted/20 rounded-2xl border-2 border-dashed">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                      <Star className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">No celebrations yet!</h3>
                    <p className="text-muted-foreground max-w-xs mx-auto mt-2">
                      Be the first to recognize a teammate for their great work and help build our team culture!
                    </p>
                    <Button variant="outline" className="mt-6" onClick={() => setShoutoutOpen(true)}>
                      Start Celebrating
                    </Button>
                  </div>
                ) : (
                  shoutoutsList.map((shoutout) => {
                    const category = getCategoryInfo(shoutout.category);
                    const reactions = (shoutout.reactions || []) as any[];
                    const hasLiked = reactions.some(r => r.userId === user?.id && r.emoji === '❤️');
                    const reactionCount = reactions.filter(r => r.emoji === '❤️').length;
                    const CategoryIcon = category.icon;

                    return (
                      <Card key={shoutout.id} className={`overflow-hidden border-2 shadow-sm rounded-xl transition-all hover:shadow-md ${category.color}`}>
                        <div className="p-5 flex gap-4">
                          <div className="flex flex-col items-center gap-2">
                            <div className="relative">
                              <Avatar className="h-14 w-14 border-2 border-white dark:border-gray-800 shadow-sm">
                                <AvatarFallback className="text-lg bg-white dark:bg-gray-800">
                                  {getUserInitials(shoutout.recipientId)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="absolute -bottom-1 -right-1 bg-white dark:bg-gray-800 rounded-full p-1 shadow-sm border">
                                <span className="text-sm leading-none">{category.emoji}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-bold text-lg leading-tight">
                                  Shoutout to {getUserName(shoutout.recipientId)}!
                                </h3>
                                <div className="flex items-center gap-1.5 text-primary/80 font-medium text-sm mt-0.5">
                                  <CategoryIcon className="h-3.5 w-3.5" />
                                  {category.label}
                                </div>
                              </div>
                              <span className="text-[10px] font-medium opacity-60 uppercase tracking-wider">
                                {format(new Date(shoutout.createdAt), 'MMM d')}
                              </span>
                            </div>
                            <div className="relative py-1">
                              <Quote className="absolute -top-1 -left-1 h-3 w-3 opacity-20 rotate-180" />
                              <p className="text-sm leading-relaxed text-foreground/90 pl-3">
                                {shoutout.message}
                              </p>
                            </div>
                            <div className="pt-2 flex items-center justify-between border-t border-black/5 dark:border-white/5 mt-2">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-6 w-6 shrink-0 border border-white/50">
                                  <AvatarFallback className="text-[8px] bg-white/50 dark:bg-black/20">
                                    {getUserInitials(shoutout.senderId)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="text-xs font-medium opacity-80">
                                  Recognized by {getUserName(shoutout.senderId)}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`h-8 rounded-full gap-1.5 px-3 transition-colors ${
                                    hasLiked
                                      ? 'bg-rose-500/20 text-rose-600 hover:bg-rose-500/30 border border-rose-200 dark:border-rose-900'
                                      : 'hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
                                  }`}
                                  onClick={() => reactToShoutoutMutation.mutate({ id: shoutout.id, emoji: '❤️' })}
                                >
                                  <Heart className={`h-4 w-4 ${hasLiked ? 'fill-current' : ''}`} />
                                  <span className="text-xs font-bold">{reactionCount > 0 ? reactionCount : 'Heart'}</span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="announcements" className="flex-1 overflow-hidden mt-0 px-4 pb-4">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="py-3 px-4 border-b flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-semibold">Announcements</CardTitle>
              {user?.role?.name === 'admin' || user?.role?.name === 'owner' ? (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2">
                      <Plus className="h-3.5 w-3.5" />
                      Post
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>New Announcement</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Content</Label>
                        <Textarea
                          placeholder="What would you like to announce to the whole team?"
                          className="min-h-[120px]"
                          value={announcementContent}
                          onChange={(e) => setAnnouncementContent(e.target.value)}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Announcements are visible to all team members and will be highlighted in their feed.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleSendAnnouncement} disabled={!announcementContent.trim() || sendAnnouncementMutation.isPending}>
                        {sendAnnouncementMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Post Announcement
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </CardHeader>
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-2xl mx-auto space-y-4">
                {messagesLoading ? (
                  <div className="space-y-4">
                    {[...Array(2)].map((_, i) => (
                      <Skeleton key={i} className="h-32 w-full rounded-xl" />
                    ))}
                  </div>
                ) : announcements.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No announcements yet</p>
                  </div>
                ) : (
                  announcements.map((ann: any) => (
                    <Card key={ann.id} className="overflow-hidden border-primary/20 bg-primary/5">
                      <CardHeader className="py-3 px-4 flex-row items-center gap-3 space-y-0 border-b bg-primary/5">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {getUserInitials(ann.senderId)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-xs font-semibold">{getUserName(ann.senderId)}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(ann.createdAt), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        <Badge variant="default" className="ml-auto text-[10px] h-5">Announcement</Badge>
                      </CardHeader>
                      <CardContent className="p-4 text-sm leading-relaxed">
                        {ann.content}
                      </CardContent>
                    </Card>
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
