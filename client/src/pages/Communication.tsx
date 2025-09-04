import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';

export default function Communication() {
  const { user } = useAuth();
  const { lastMessage } = useWebSocket();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messageContent, setMessageContent] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ['/api/messages'],
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { content: string; isAnnouncement: boolean; recipientId?: string }) => {
      return await apiRequest('POST', '/api/messages', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/messages'] });
      setMessageContent('');
      setAnnouncementContent('');
      toast({
        title: "Message sent",
        description: "Your message has been sent successfully.",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Update messages in real-time
  useEffect(() => {
    if (lastMessage?.type === 'message_created') {
      queryClient.invalidateQueries({ queryKey: ['/api/messages'] });
    }
  }, [lastMessage, queryClient]);

  const handleSendMessage = () => {
    if (!messageContent.trim()) return;
    
    sendMessageMutation.mutate({
      content: messageContent,
      isAnnouncement: false,
    });
  };

  const handleSendAnnouncement = () => {
    if (!announcementContent.trim()) return;
    
    sendMessageMutation.mutate({
      content: announcementContent,
      isAnnouncement: true,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4">
        <h1 className="text-xl font-bold">Communications Hub</h1>
        <p className="text-sm opacity-80">Team chat & announcements</p>
      </header>

      <div className="p-4">
        <Tabs defaultValue="feed" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="feed">Team Feed</TabsTrigger>
            <TabsTrigger value="chat">Direct Chat</TabsTrigger>
            <TabsTrigger value="announcements">Announce</TabsTrigger>
          </TabsList>

          <TabsContent value="feed" className="space-y-4">
            {/* Company Updates Feed */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-bullhorn text-primary mr-2"></i>
                  Company Updates
                </CardTitle>
              </CardHeader>
              <CardContent>
                {messagesLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse">
                        <div className="flex space-x-3">
                          <div className="w-8 h-8 bg-muted rounded-full"></div>
                          <div className="flex-1 space-y-1">
                            <div className="h-3 bg-muted rounded w-1/4"></div>
                            <div className="h-4 bg-muted rounded w-3/4"></div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : messages?.filter((msg: any) => msg.isAnnouncement).length === 0 ? (
                  <div className="text-center py-8">
                    <i className="fas fa-bullhorn text-muted-foreground text-2xl mb-2"></i>
                    <p className="text-muted-foreground">No announcements yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages
                      ?.filter((msg: any) => msg.isAnnouncement)
                      .slice(0, 10)
                      .map((message: any) => (
                        <div key={message.id} className="flex space-x-3 p-3 bg-muted/30 rounded-lg">
                          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                            <i className="fas fa-building text-primary-foreground text-xs"></i>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-medium text-sm">Company Announcement</p>
                              <span className="text-xs text-muted-foreground">
                                {new Date(message.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-sm text-foreground">{message.content}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Team Activity */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-users text-primary mr-2"></i>
                  Recent Team Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* This would be populated with real-time team activity data */}
                  <div className="text-center py-4">
                    <i className="fas fa-clock text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">Team activity will appear here</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chat" className="space-y-4">
            {/* Direct Messages */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Direct Messages</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex space-x-2">
                    <Input
                      placeholder="Type your message..."
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      data-testid="message-input"
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={!messageContent.trim() || sendMessageMutation.isPending}
                      data-testid="send-message-button"
                    >
                      {sendMessageMutation.isPending ? (
                        <i className="fas fa-spinner fa-spin"></i>
                      ) : (
                        <i className="fas fa-paper-plane"></i>
                      )}
                    </Button>
                  </div>

                  {/* Chat Messages */}
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {messages?.filter((msg: any) => !msg.isAnnouncement).length === 0 ? (
                      <div className="text-center py-8">
                        <i className="fas fa-comments text-muted-foreground text-2xl mb-2"></i>
                        <p className="text-muted-foreground">No messages yet. Start a conversation!</p>
                      </div>
                    ) : (
                      messages
                        ?.filter((msg: any) => !msg.isAnnouncement)
                        .map((message: any) => (
                          <div key={message.id} className="flex space-x-3">
                            <img 
                              src={`https://api.dicebear.com/7.x/initials/svg?seed=${message.senderId}`}
                              alt="Sender avatar"
                              className="w-8 h-8 rounded-full"
                            />
                            <div className="flex-1">
                              <div className="bg-muted rounded-lg p-3">
                                <p className="text-sm">{message.content}</p>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {new Date(message.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="announcements" className="space-y-4">
            {user?.role === 'admin' ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Send Announcement</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Write your announcement here..."
                    value={announcementContent}
                    onChange={(e) => setAnnouncementContent(e.target.value)}
                    className="min-h-24"
                    data-testid="announcement-textarea"
                  />
                  
                  <div className="flex items-center space-x-2">
                    <Switch data-testid="announcement-priority" />
                    <label className="text-sm">High Priority</label>
                  </div>

                  <Button
                    onClick={handleSendAnnouncement}
                    disabled={!announcementContent.trim() || sendMessageMutation.isPending}
                    className="w-full"
                    data-testid="send-announcement-button"
                  >
                    {sendMessageMutation.isPending ? (
                      <>
                        <i className="fas fa-spinner fa-spin mr-2"></i>
                        Sending...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-bullhorn mr-2"></i>
                        Send Announcement
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <i className="fas fa-lock text-muted-foreground text-2xl mb-2"></i>
                  <p className="text-muted-foreground">Admin access required to send announcements</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Communication Settings */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center">
              <i className="fas fa-cog text-primary mr-2"></i>
              Notification Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Push Notifications</span>
              <Switch defaultChecked data-testid="push-notifications-toggle" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Clock Reminders</span>
              <Switch defaultChecked data-testid="clock-reminders-toggle" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Task Notifications</span>
              <Switch defaultChecked data-testid="task-notifications-toggle" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Team Updates</span>
              <Switch defaultChecked data-testid="team-updates-toggle" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
