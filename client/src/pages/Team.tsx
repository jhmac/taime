import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { User, Role, Message } from "@shared/schema";

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMember, setSelectedMember] = useState<User | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [messageType, setMessageType] = useState<'individual' | 'broadcast'>('individual');

  // Fetch team members
  const { data: teamMembers = [], isLoading: membersLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Fetch roles for assignment
  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/roles"],
  });

  // Fetch messages
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/messages"],
  });

  // Add team member mutation
  const addMemberMutation = useMutation({
    mutationFn: async (memberData: any) => {
      const response = await apiRequest("POST", "/api/users", memberData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setShowAddMember(false);
      toast({
        title: "Success",
        description: "Team member added successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to add team member: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Update member role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      const response = await apiRequest("PUT", `/api/users/${userId}/role`, { roleId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "Role updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update role: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (messageData: any) => {
      const response = await apiRequest("POST", "/api/messages", messageData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      setShowMessage(false);
      toast({
        title: "Success",
        description: messageType === 'broadcast' ? "Announcement sent to all team members" : "Message sent successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to send message: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Deactivate member mutation
  const deactivateMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("PUT", `/api/users/${userId}`, { isActive: false });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "Team member deactivated",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to deactivate member: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handleAddMember = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const memberData = {
      email: formData.get("email") as string,
      firstName: formData.get("firstName") as string,
      lastName: formData.get("lastName") as string,
      roleId: formData.get("roleId") as string,
      hourlyRate: formData.get("hourlyRate") as string,
    };
    addMemberMutation.mutate(memberData);
  };

  const handleSendMessage = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const messageData = {
      content: formData.get("content") as string,
      recipientId: messageType === 'individual' ? selectedMember?.id : null,
      isAnnouncement: messageType === 'broadcast',
    };
    sendMessageMutation.mutate(messageData);
  };

  const handleRoleChange = (userId: string, roleId: string) => {
    updateRoleMutation.mutate({ userId, roleId });
  };

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  const getRoleBadgeColor = (roleName?: string) => {
    switch (roleName) {
      case 'owner': return 'bg-purple-500';
      case 'manager': return 'bg-blue-500';
      case 'assistant_manager': return 'bg-green-500';
      case 'team_member': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  };

  const getActiveMembers = () => teamMembers.filter(member => member.isActive !== false);
  const getInactiveMembers = () => teamMembers.filter(member => member.isActive === false);

  if (membersLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">Team Management</h1>
          <p className="text-muted-foreground">Manage your team members, roles, and communication</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Dialog open={showMessage} onOpenChange={setShowMessage}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-send-message">
                <i className="fas fa-envelope mr-2"></i>
                Send Message
              </Button>
            </DialogTrigger>
          </Dialog>
          <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-member">
                <i className="fas fa-plus mr-2"></i>
                Add Team Member
              </Button>
            </DialogTrigger>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="active" data-testid="tab-active-members">
            Active Members ({getActiveMembers().length})
          </TabsTrigger>
          <TabsTrigger value="inactive" data-testid="tab-inactive-members">
            Inactive ({getInactiveMembers().length})
          </TabsTrigger>
          <TabsTrigger value="messages" data-testid="tab-messages">
            Messages ({messages.length})
          </TabsTrigger>
        </TabsList>

        {/* Active Members Tab */}
        <TabsContent value="active" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {getActiveMembers().map((member) => {
              const memberRole = roles.find(r => r.id === member.roleId);
              return (
                <Card key={member.id} className="hover:shadow-md transition-shadow" data-testid={`card-member-${member.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center space-x-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={member.profileImageUrl || undefined} />
                        <AvatarFallback>{getInitials(member.firstName, member.lastName)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg truncate">
                          {member.firstName} {member.lastName}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Role:</span>
                      <Select value={member.roleId || ""} onValueChange={(value) => handleRoleChange(member.id, value)}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {memberRole && (
                      <Badge className={`${getRoleBadgeColor(memberRole.name)} text-white`}>
                        {memberRole.displayName}
                      </Badge>
                    )}
                    
                    {member.hourlyRate && (
                      <div className="text-sm text-muted-foreground">
                        Rate: ${member.hourlyRate}/hr
                      </div>
                    )}
                    
                    <div className="flex justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedMember(member);
                          setShowProfile(true);
                        }}
                        data-testid={`button-view-profile-${member.id}`}
                      >
                        <i className="fas fa-user mr-1"></i>
                        Profile
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedMember(member);
                          setMessageType('individual');
                          setShowMessage(true);
                        }}
                        data-testid={`button-message-${member.id}`}
                      >
                        <i className="fas fa-envelope mr-1"></i>
                        Message
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          
          {getActiveMembers().length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No active team members found.</p>
            </div>
          )}
        </TabsContent>

        {/* Inactive Members Tab */}
        <TabsContent value="inactive" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {getInactiveMembers().map((member) => (
              <Card key={member.id} className="opacity-60" data-testid={`card-inactive-member-${member.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center space-x-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={member.profileImageUrl || undefined} />
                      <AvatarFallback>{getInitials(member.firstName, member.lastName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">
                        {member.firstName} {member.lastName}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                      <Badge variant="secondary" className="mt-1">Inactive</Badge>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
          
          {getInactiveMembers().length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No inactive members.</p>
            </div>
          )}
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="space-y-4">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setMessageType('broadcast');
                setShowMessage(true);
              }}
              data-testid="button-broadcast-message"
            >
              <i className="fas fa-bullhorn mr-2"></i>
              Send Announcement
            </Button>
          </div>
          
          <div className="space-y-3">
            {messages.slice(0, 10).map((message) => (
              <Card key={message.id} data-testid={`message-${message.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        {message.isAnnouncement && (
                          <Badge variant="secondary">
                            <i className="fas fa-bullhorn mr-1"></i>
                            Announcement
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground">
                          {new Date(message.createdAt!).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm">{message.content}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {messages.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No messages yet.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Member Dialog */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent data-testid="dialog-add-member">
          <DialogHeader>
            <DialogTitle>Add New Team Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  required
                  data-testid="input-last-name"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                data-testid="input-email"
              />
            </div>
            <div>
              <Label htmlFor="roleId">Role</Label>
              <Select name="roleId" required>
                <SelectTrigger data-testid="select-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="hourlyRate">Hourly Rate (optional)</Label>
              <Input
                id="hourlyRate"
                name="hourlyRate"
                type="number"
                step="0.01"
                placeholder="25.00"
                data-testid="input-hourly-rate"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setShowAddMember(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addMemberMutation.isPending} data-testid="button-save-member">
                {addMemberMutation.isPending ? "Adding..." : "Add Member"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send Message Dialog */}
      <Dialog open={showMessage} onOpenChange={setShowMessage}>
        <DialogContent data-testid="dialog-send-message">
          <DialogHeader>
            <DialogTitle>
              {messageType === 'broadcast' ? 'Send Announcement' : `Message ${selectedMember?.firstName} ${selectedMember?.lastName}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSendMessage} className="space-y-4">
            <div>
              <Label htmlFor="content">Message</Label>
              <Textarea
                id="content"
                name="content"
                placeholder={messageType === 'broadcast' ? "Type your announcement..." : "Type your message..."}
                required
                rows={4}
                data-testid="textarea-message-content"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setShowMessage(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sendMessageMutation.isPending} data-testid="button-send">
                {sendMessageMutation.isPending ? "Sending..." : messageType === 'broadcast' ? "Send Announcement" : "Send Message"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Profile Dialog */}
      <Dialog open={showProfile} onOpenChange={setShowProfile}>
        <DialogContent data-testid="dialog-member-profile">
          <DialogHeader>
            <DialogTitle>Team Member Profile</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <div className="space-y-6">
              <div className="flex items-center space-x-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={selectedMember.profileImageUrl || undefined} />
                  <AvatarFallback className="text-lg">
                    {getInitials(selectedMember.firstName, selectedMember.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-xl font-semibold">
                    {selectedMember.firstName} {selectedMember.lastName}
                  </h3>
                  <p className="text-muted-foreground">{selectedMember.email}</p>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="font-medium">Role:</span>
                  <span>{roles.find(r => r.id === selectedMember.roleId)?.displayName || 'Not assigned'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Status:</span>
                  <Badge variant={selectedMember.isActive !== false ? "default" : "secondary"}>
                    {selectedMember.isActive !== false ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {selectedMember.hourlyRate && (
                  <div className="flex justify-between">
                    <span className="font-medium">Hourly Rate:</span>
                    <span>${selectedMember.hourlyRate}/hr</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-medium">Joined:</span>
                  <span>{new Date(selectedMember.createdAt!).toLocaleDateString()}</span>
                </div>
              </div>
              
              <Separator />
              
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    setMessageType('individual');
                    setShowProfile(false);
                    setShowMessage(true);
                  }}
                  data-testid="button-send-message-from-profile"
                >
                  <i className="fas fa-envelope mr-2"></i>
                  Send Message
                </Button>
                {selectedMember.isActive !== false && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      deactivateMemberMutation.mutate(selectedMember.id);
                      setShowProfile(false);
                    }}
                    data-testid="button-deactivate-member"
                  >
                    <i className="fas fa-user-times mr-2"></i>
                    Deactivate
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}