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
import type { User, Role, Message, Permission, ChatGroup } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";

export default function Team() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedMember, setSelectedMember] = useState<User | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [messageType, setMessageType] = useState<'individual' | 'broadcast'>('individual');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(null);

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

  // Get current user and permissions
  const { user: currentUser } = useAuth();

  // Fetch groups
  const { data: groups = [] } = useQuery<ChatGroup[]>({
    queryKey: ["/api/groups"],
    enabled: !!currentUser,
  });
  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!currentUser,
  });

  // Check permissions - safely check if userPermissions exists and is an array
  const canManageEmployees = userPermissions?.some?.(p => p.name === 'hr.manage_employees') || false;
  const canEditRoles = userPermissions?.some?.(p => p.name === 'admin.role_management') || false;
  const canViewPayRates = userPermissions?.some?.(p => p.name === 'hr.view_pay_rates') || false;
  const canEditPayRates = userPermissions?.some?.(p => p.name === 'hr.edit_pay_rates') || false;
  const canCreateGroups = userPermissions?.some?.(p => p.name === 'communication.create_groups') || false;
  const canManageGroups = userPermissions?.some?.(p => p.name === 'communication.manage_groups') || false;

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

  // Create group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (groupData: any) => {
      const response = await apiRequest("POST", "/api/groups", groupData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowCreateGroup(false);
      toast({
        title: "Success",
        description: "Group created successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create group: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Update member pay rate mutation
  const updatePayRateMutation = useMutation({
    mutationFn: async ({ userId, hourlyRate }: { userId: string; hourlyRate: string }) => {
      const response = await apiRequest("PUT", `/api/users/${userId}/pay-rate`, { hourlyRate });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "Pay rate updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update pay rate: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Remove member mutation (permanent deletion)
  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("DELETE", `/api/users/${userId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "Team member removed successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to remove member: ${error.message}`,
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

  const handleCreateGroup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const memberIds = Array.from(formData.getAll("memberIds")) as string[];
    const groupData = {
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      memberIds: memberIds.filter(id => id), // Remove empty values
    };
    createGroupMutation.mutate(groupData);
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
    if (!canEditRoles) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to change roles",
        variant: "destructive",
      });
      return;
    }
    updateRoleMutation.mutate({ userId, roleId });
  };

  const handlePayRateChange = (userId: string, hourlyRate: string) => {
    if (!canEditPayRates) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to edit pay rates",
        variant: "destructive",
      });
      return;
    }
    updatePayRateMutation.mutate({ userId, hourlyRate });
  };

  const handleRemoveMember = (userId: string) => {
    if (!canManageEmployees) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to remove employees",
        variant: "destructive",
      });
      return;
    }
    if (confirm("Are you sure you want to permanently remove this team member? This action cannot be undone.")) {
      removeMemberMutation.mutate(userId);
    }
  };

  const handleDeactivateMember = (userId: string) => {
    if (!canManageEmployees) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to deactivate employees",
        variant: "destructive",
      });
      return;
    }
    deactivateMemberMutation.mutate(userId);
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

  const getActiveMembers = () => teamMembers?.filter(member => member.isActive !== false) || [];
  const getInactiveMembers = () => teamMembers?.filter(member => member.isActive === false) || [];

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
          {canManageEmployees && (
            <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-member">
                  <i className="fas fa-plus mr-2"></i>
                  Add Team Member
                </Button>
              </DialogTrigger>
            </Dialog>
          )}
        </div>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="active" data-testid="tab-active-members">
            Active ({getActiveMembers().length})
          </TabsTrigger>
          <TabsTrigger value="inactive" data-testid="tab-inactive-members">
            Inactive ({getInactiveMembers().length})
          </TabsTrigger>
          <TabsTrigger value="groups" data-testid="tab-groups">
            Groups ({groups.length})
          </TabsTrigger>
          <TabsTrigger value="messages" data-testid="tab-messages">
            Messages ({messages.length})
          </TabsTrigger>
        </TabsList>

        {/* Active Members Tab */}
        <TabsContent value="active" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {getActiveMembers().map((member) => {
              const memberRole = roles?.find(r => r.id === member.roleId);
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
                      {canEditRoles && roles?.length > 0 ? (
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
                      ) : (
                        <span className="text-sm">{memberRole?.displayName || 'Not assigned'}</span>
                      )}
                    </div>
                    
                    {memberRole && (
                      <Badge className={`${getRoleBadgeColor(memberRole.name)} text-white`}>
                        {memberRole.displayName}
                      </Badge>
                    )}
                    
                    {canViewPayRates && member.hourlyRate && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Rate:</span>
                          {canEditPayRates ? (
                            <div className="flex items-center space-x-2">
                              <Input
                                type="number"
                                step="0.01"
                                defaultValue={member.hourlyRate}
                                className="w-20 h-8 text-sm"
                                onBlur={(e) => {
                                  const newRate = e.target.value;
                                  if (newRate !== member.hourlyRate) {
                                    handlePayRateChange(member.id, newRate);
                                  }
                                }}
                                data-testid={`input-pay-rate-${member.id}`}
                              />
                              <span className="text-sm text-muted-foreground">/hr</span>
                            </div>
                          ) : (
                            <span className="text-sm">${member.hourlyRate}/hr</span>
                          )}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex flex-col space-y-2 pt-2">
                      <div className="flex justify-between space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
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
                          className="flex-1"
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
                      {canManageEmployees && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="w-full"
                          onClick={() => handleRemoveMember(member.id)}
                          data-testid={`button-remove-${member.id}`}
                        >
                          <i className="fas fa-trash mr-1"></i>
                          Remove Employee
                        </Button>
                      )}
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
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
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

        {/* Groups Tab */}
        <TabsContent value="groups" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Chat Groups</h3>
            {canCreateGroups && (
              <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-group">
                    <i className="fas fa-plus mr-2"></i>
                    Create Group
                  </Button>
                </DialogTrigger>
              </Dialog>
            )}
          </div>
          
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <Card key={group.id} className="hover:shadow-md transition-shadow" data-testid={`card-group-${group.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                      <i className="fas fa-users text-primary text-lg"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">
                        {group.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground truncate">{group.description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Created: {new Date(group.createdAt!).toLocaleDateString()}
                    </span>
                    <Badge variant="secondary">
                      <i className="fas fa-user mr-1"></i>
                      Members
                    </Badge>
                  </div>
                  
                  <div className="flex space-x-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedGroup(group);
                        // TODO: Open group chat
                      }}
                      data-testid={`button-open-group-${group.id}`}
                    >
                      <i className="fas fa-comments mr-1"></i>
                      Open Chat
                    </Button>
                    {canManageGroups && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedGroup(group);
                          // TODO: Manage group members
                        }}
                        data-testid={`button-manage-group-${group.id}`}
                      >
                        <i className="fas fa-cog mr-1"></i>
                        Manage
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {groups.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No groups found.</p>
              {canCreateGroups && (
                <p className="text-sm text-muted-foreground mt-2">
                  Create your first group to start collaborating with your team!
                </p>
              )}
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

      {/* Create Group Dialog */}
      <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
        <DialogContent data-testid="dialog-create-group">
          <DialogHeader>
            <DialogTitle>Create New Group</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateGroup} className="space-y-4">
            <div>
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                name="name"
                required
                placeholder="Team Leaders"
                data-testid="input-group-name"
              />
            </div>
            <div>
              <Label htmlFor="groupDescription">Description (optional)</Label>
              <Textarea
                id="groupDescription"
                name="description"
                placeholder="Group for leadership discussions and announcements"
                rows={2}
                data-testid="textarea-group-description"
              />
            </div>
            <div>
              <Label>Select Members</Label>
              <div className="max-h-48 overflow-y-auto space-y-2 mt-2 p-2 border rounded-md">
                {teamMembers.map((member) => (
                  <div key={member.id} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`member-${member.id}`}
                      name="memberIds"
                      value={member.id}
                      className="rounded"
                      data-testid={`checkbox-member-${member.id}`}
                    />
                    <label htmlFor={`member-${member.id}`} className="flex items-center space-x-2 flex-1 cursor-pointer">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={member.profileImageUrl || undefined} />
                        <AvatarFallback className="text-xs">{getInitials(member.firstName, member.lastName)}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{member.firstName} {member.lastName}</span>
                      <span className="text-xs text-muted-foreground">
                        {roles.find(r => r.id === member.roleId)?.displayName}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setShowCreateGroup(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createGroupMutation.isPending} data-testid="button-save-group">
                {createGroupMutation.isPending ? "Creating..." : "Create Group"}
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
                  <span>{roles?.find(r => r.id === selectedMember.roleId)?.displayName || 'Not assigned'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Status:</span>
                  <Badge variant={selectedMember.isActive !== false ? "default" : "secondary"}>
                    {selectedMember.isActive !== false ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {canViewPayRates && selectedMember.hourlyRate && (
                  <div className="flex justify-between">
                    <span className="font-medium">Hourly Rate:</span>
                    {canEditPayRates ? (
                      <div className="flex items-center space-x-2">
                        <Input
                          type="number"
                          step="0.01"
                          defaultValue={selectedMember.hourlyRate}
                          className="w-24 h-8 text-sm"
                          onBlur={(e) => {
                            const newRate = e.target.value;
                            if (newRate !== selectedMember.hourlyRate) {
                              handlePayRateChange(selectedMember.id, newRate);
                            }
                          }}
                          data-testid="input-profile-pay-rate"
                        />
                        <span className="text-sm">/hr</span>
                      </div>
                    ) : (
                      <span>${selectedMember.hourlyRate}/hr</span>
                    )}
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
                {canManageEmployees && (
                  <div className="flex space-x-2">
                    {selectedMember.isActive !== false && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          handleDeactivateMember(selectedMember.id);
                          setShowProfile(false);
                        }}
                        data-testid="button-deactivate-member"
                      >
                        <i className="fas fa-user-times mr-2"></i>
                        Deactivate
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      onClick={() => {
                        handleRemoveMember(selectedMember.id);
                        setShowProfile(false);
                      }}
                      data-testid="button-remove-member-profile"
                    >
                      <i className="fas fa-trash mr-2"></i>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}