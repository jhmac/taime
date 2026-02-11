import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { Task, User, Permission } from '@shared/schema';

const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TIME_PERIODS = ['morning', 'afternoon', 'evening'];
const CHORE_ZONES = ['zone 1', 'zone 2', 'zone 3', 'zone 4', 'zone 5'];
const PRIORITIES = ['low', 'medium', 'high'];

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const emptyForm = {
  title: '',
  description: '',
  assignedTo: '',
  dayOfWeek: '',
  timeOfDay: '',
  choreZone: '',
  priority: 'medium',
  isRecurring: false,
  requiresSignature: false,
  estimatedMinutes: 30,
  dueDate: '',
};

export default function TaskManagement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Task | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [filterDay, setFilterDay] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssigned, setFilterAssigned] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin';

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const canManageTasks = userPermissions?.some?.(p =>
    p.name === 'tasks.edit_all' || p.name === 'tasks.create' || p.name === 'admin.manage_all'
  ) || isAdmin || false;

  const canDeleteTasks = userPermissions?.some?.(p =>
    p.name === 'tasks.edit_all' || p.name === 'admin.manage_all'
  ) || isAdmin || false;

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['/api/tasks'],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['/api/users'],
  });

  const activeUsers = users.filter((u: any) => u.isActive !== false);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest('POST', '/api/tasks', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setShowCreateDialog(false);
      setForm(emptyForm);
      toast({ title: "Task Created", description: "Task has been created successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to create task: ${error.message}`, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequest('PATCH', `/api/tasks/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setEditingTask(null);
      setForm(emptyForm);
      toast({ title: "Task Updated", description: "Task has been updated successfully." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to update task: ${error.message}`, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/tasks/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setDeleteConfirm(null);
      toast({ title: "Task Deleted", description: "Task has been deleted." });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to delete task: ${error.message}`, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === 'completed') updates.completedAt = new Date().toISOString();
      const res = await apiRequest('PATCH', `/api/tasks/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: "Status Updated" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      const res = await apiRequest('PATCH', `/api/tasks/${id}`, { assignedTo: userId || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      toast({ title: "Task Assigned" });
    },
  });

  const handleCreateOrEdit = () => {
    const payload: any = {
      title: form.title,
      description: form.description || null,
      assignedTo: form.assignedTo || null,
      dayOfWeek: form.dayOfWeek || null,
      timeOfDay: form.timeOfDay || null,
      choreZone: form.choreZone || null,
      priority: form.priority,
      isRecurring: form.isRecurring,
      requiresSignature: form.requiresSignature,
      estimatedMinutes: form.estimatedMinutes || null,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
    };

    if (editingTask) {
      updateMutation.mutate({ id: editingTask.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setForm({
      title: task.title || '',
      description: task.description || '',
      assignedTo: task.assignedTo || '',
      dayOfWeek: task.dayOfWeek || '',
      timeOfDay: task.timeOfDay || '',
      choreZone: task.choreZone || '',
      priority: task.priority || 'medium',
      isRecurring: task.isRecurring || false,
      requiresSignature: task.requiresSignature || false,
      estimatedMinutes: task.estimatedMinutes || 30,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 16) : '',
    });
  };

  const openCreate = () => {
    setEditingTask(null);
    setForm(emptyForm);
    setShowCreateDialog(true);
  };

  const getUserName = (userId: string | null) => {
    if (!userId) return 'Unassigned';
    const u = users.find(u => u.id === userId);
    return u ? `${u.firstName} ${u.lastName}` : 'Unknown';
  };

  const filteredTasks = tasks.filter(task => {
    if (activeTab === 'recurring' && !task.isRecurring) return false;
    if (activeTab === 'one-time' && task.isRecurring) return false;
    if (activeTab === 'my-tasks' && task.assignedTo !== user?.id) return false;
    if (filterDay !== 'all' && task.dayOfWeek !== filterDay) return false;
    if (filterZone !== 'all' && task.choreZone !== filterZone) return false;
    if (filterStatus !== 'all' && task.status !== filterStatus) return false;
    if (filterAssigned === 'unassigned' && task.assignedTo) return false;
    if (filterAssigned === 'assigned' && !task.assignedTo) return false;
    if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const taskStats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    unassigned: tasks.filter(t => !t.assignedTo).length,
    recurring: tasks.filter(t => t.isRecurring).length,
  };

  const todayDay = DAYS_OF_WEEK[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
  const todaysTasks = tasks.filter(t => t.dayOfWeek === todayDay);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Tasks & Chores</h2>
            <p className="text-sm text-muted-foreground">Manage daily tasks and recurring chores</p>
          </div>
          {canManageTasks && (
            <Button onClick={openCreate} data-testid="create-task-btn">
              <i className="fas fa-plus mr-2"></i>New Task
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{taskStats.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-yellow-600">{taskStats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{taskStats.inProgress}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{taskStats.completed}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{taskStats.unassigned}</p>
              <p className="text-xs text-muted-foreground">Unassigned</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">{taskStats.recurring}</p>
              <p className="text-xs text-muted-foreground">Recurring</p>
            </CardContent>
          </Card>
        </div>

        {todaysTasks.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <i className="fas fa-calendar-day text-primary"></i>
                Today's Chores ({todayDay.charAt(0).toUpperCase() + todayDay.slice(1)})
                <Badge className="ml-auto">{todaysTasks.length} tasks</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2">
                {todaysTasks.slice(0, 6).map(task => (
                  <div key={task.id} className="flex items-center justify-between p-2 rounded-lg bg-background border">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => statusMutation.mutate({
                          id: task.id,
                          status: task.status === 'completed' ? 'pending' : 'completed'
                        })}
                        className="flex-shrink-0"
                      >
                        <i className={`fas ${task.status === 'completed' ? 'fa-check-circle text-green-500' : 'fa-circle text-gray-300'}`}></i>
                      </button>
                      <span className={`text-sm truncate ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {task.timeOfDay && (
                        <Badge variant="outline" className="text-[10px]">{task.timeOfDay}</Badge>
                      )}
                      {task.choreZone && (
                        <Badge variant="outline" className="text-[10px]">{task.choreZone}</Badge>
                      )}
                    </div>
                  </div>
                ))}
                {todaysTasks.length > 6 && (
                  <p className="text-xs text-muted-foreground p-2">+{todaysTasks.length - 6} more tasks</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All Tasks</TabsTrigger>
            <TabsTrigger value="recurring">Recurring</TabsTrigger>
            <TabsTrigger value="one-time">One-Time</TabsTrigger>
            <TabsTrigger value="my-tasks">My Tasks</TabsTrigger>
          </TabsList>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="max-w-xs"
                data-testid="task-search"
              />
              <Select value={filterDay} onValueChange={setFilterDay}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Day" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Days</SelectItem>
                  {DAYS_OF_WEEK.map(d => (
                    <SelectItem key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterZone} onValueChange={setFilterZone}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Zones</SelectItem>
                  {CHORE_ZONES.map(z => (
                    <SelectItem key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterAssigned} onValueChange={setFilterAssigned}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Assignment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">{filteredTasks.length} tasks found</p>

            <TabsContent value={activeTab} className="mt-0">
              <div className="space-y-2">
                {filteredTasks.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <i className="fas fa-clipboard-list text-4xl text-muted-foreground/30 mb-3"></i>
                      <p className="text-muted-foreground">No tasks found matching your filters.</p>
                      {canManageTasks && (
                        <Button variant="outline" className="mt-4" onClick={openCreate}>
                          <i className="fas fa-plus mr-2"></i>Create a Task
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  filteredTasks.map(task => (
                    <Card key={task.id} className="hover:shadow-sm transition-shadow" data-testid={`task-card-${task.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => statusMutation.mutate({
                              id: task.id,
                              status: task.status === 'completed' ? 'pending' : 'completed'
                            })}
                            className="mt-1 flex-shrink-0"
                            data-testid={`toggle-task-${task.id}`}
                          >
                            <i className={`fas text-lg ${task.status === 'completed'
                              ? 'fa-check-circle text-green-500'
                              : task.status === 'in_progress'
                                ? 'fa-dot-circle text-blue-500'
                                : 'fa-circle text-gray-300 hover:text-gray-400'}`}></i>
                          </button>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className={`font-medium text-sm ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                                  {task.title}
                                </h4>
                                {task.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {canManageTasks && (
                                  <>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(task)} data-testid={`edit-task-${task.id}`}>
                                      <i className="fas fa-pencil-alt text-xs"></i>
                                    </Button>
                                    {canDeleteTasks && (
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(task)} data-testid={`delete-task-${task.id}`}>
                                        <i className="fas fa-trash-alt text-xs"></i>
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <Badge className={`text-[10px] ${STATUS_COLORS[task.status || 'pending']}`}>
                                {task.status?.replace('_', ' ')}
                              </Badge>
                              {task.priority && (
                                <Badge className={`text-[10px] ${PRIORITY_COLORS[task.priority]}`}>
                                  {task.priority}
                                </Badge>
                              )}
                              {task.dayOfWeek && (
                                <Badge variant="outline" className="text-[10px]">
                                  <i className="fas fa-calendar-day mr-1"></i>{task.dayOfWeek}
                                </Badge>
                              )}
                              {task.timeOfDay && (
                                <Badge variant="outline" className="text-[10px]">
                                  <i className="fas fa-clock mr-1"></i>{task.timeOfDay}
                                </Badge>
                              )}
                              {task.choreZone && (
                                <Badge variant="outline" className="text-[10px]">
                                  <i className="fas fa-map-pin mr-1"></i>{task.choreZone}
                                </Badge>
                              )}
                              {task.isRecurring && (
                                <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700 dark:text-purple-400">
                                  <i className="fas fa-sync-alt mr-1"></i>recurring
                                </Badge>
                              )}
                              {task.requiresSignature && (
                                <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700 dark:text-orange-400">
                                  <i className="fas fa-signature mr-1"></i>sign-off
                                </Badge>
                              )}
                              {task.estimatedMinutes && (
                                <Badge variant="outline" className="text-[10px]">
                                  <i className="fas fa-hourglass-half mr-1"></i>{task.estimatedMinutes}m
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center justify-between mt-2">
                              <div className="flex items-center gap-2">
                                <i className="fas fa-user-tag text-xs text-muted-foreground"></i>
                                {canManageTasks ? (
                                  <Select
                                    value={task.assignedTo || 'unassigned'}
                                    onValueChange={(val) => assignMutation.mutate({
                                      id: task.id,
                                      userId: val === 'unassigned' ? '' : val
                                    })}
                                  >
                                    <SelectTrigger className="h-6 text-xs w-[150px] border-dashed">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="unassigned">Unassigned</SelectItem>
                                      {activeUsers.map(u => (
                                        <SelectItem key={u.id} value={u.id}>
                                          {u.firstName} {u.lastName}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{getUserName(task.assignedTo)}</span>
                                )}
                              </div>
                              {canManageTasks && task.status !== 'completed' && (
                                <Select
                                  value={task.status || 'pending'}
                                  onValueChange={(val) => statusMutation.mutate({ id: task.id, status: val })}
                                >
                                  <SelectTrigger className="h-6 text-xs w-[120px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="in_progress">In Progress</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                    <SelectItem value="cancelled">Cancelled</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <Dialog open={showCreateDialog || !!editingTask} onOpenChange={(open) => {
        if (!open) { setShowCreateDialog(false); setEditingTask(null); setForm(emptyForm); }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? 'Edit Task' : 'Create New Task'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Task title"
                data-testid="task-title-input"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Optional description"
                rows={3}
                data-testid="task-description-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Assign To</Label>
                <Select value={form.assignedTo || 'none'} onValueChange={val => setForm(prev => ({ ...prev, assignedTo: val === 'none' ? '' : val }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {activeUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={val => setForm(prev => ({ ...prev, priority: val }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Day of Week</Label>
                <Select value={form.dayOfWeek || 'none'} onValueChange={val => setForm(prev => ({ ...prev, dayOfWeek: val === 'none' ? '' : val }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select day" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No specific day</SelectItem>
                    {DAYS_OF_WEEK.map(d => (
                      <SelectItem key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Time of Day</Label>
                <Select value={form.timeOfDay || 'none'} onValueChange={val => setForm(prev => ({ ...prev, timeOfDay: val === 'none' ? '' : val }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any time</SelectItem>
                    {TIME_PERIODS.map(t => (
                      <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Chore Zone</Label>
                <Select value={form.choreZone || 'none'} onValueChange={val => setForm(prev => ({ ...prev, choreZone: val === 'none' ? '' : val }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No zone</SelectItem>
                    {CHORE_ZONES.map(z => (
                      <SelectItem key={z} value={z}>{z.charAt(0).toUpperCase() + z.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Est. Minutes</Label>
                <Input
                  type="number"
                  value={form.estimatedMinutes}
                  onChange={e => setForm(prev => ({ ...prev, estimatedMinutes: parseInt(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div>
              <Label>Due Date</Label>
              <Input
                type="datetime-local"
                value={form.dueDate}
                onChange={e => setForm(prev => ({ ...prev, dueDate: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={form.isRecurring} onCheckedChange={val => setForm(prev => ({ ...prev, isRecurring: val }))} />
                <Label className="text-sm">Recurring</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.requiresSignature} onCheckedChange={val => setForm(prev => ({ ...prev, requiresSignature: val }))} />
                <Label className="text-sm">Requires Sign-off</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingTask(null); setForm(emptyForm); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateOrEdit}
              disabled={!form.title || createMutation.isPending || updateMutation.isPending}
              data-testid="save-task-btn"
            >
              {(createMutation.isPending || updateMutation.isPending)
                ? <><i className="fas fa-spinner fa-spin mr-2"></i>Saving...</>
                : <><i className="fas fa-save mr-2"></i>{editingTask ? 'Update Task' : 'Create Task'}</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Task</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete "{deleteConfirm?.title}"? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
              data-testid="confirm-delete-btn"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
