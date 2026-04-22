import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Task, User, Permission, TaskAssignee } from '@shared/schema';

type VerificationItem = {
  assignee: TaskAssignee;
  task: Task;
  user: { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null };
  streak: number;
};

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
  const [filterAIAssign, setFilterAIAssign] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [rejectingItem, setRejectingItem] = useState<VerificationItem | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [broadcastingTask, setBroadcastingTask] = useState<Task | null>(null);
  const [broadcastAfterCreate, setBroadcastAfterCreate] = useState(false);

  const isAdmin = user?.role?.name === 'owner' || user?.role?.name === 'admin';

  // Real-time WebSocket: invalidate task list, verification queue, and broadcast progress on assignment events
  const { lastMessage } = useWebSocket();
  useEffect(() => {
    if (!lastMessage) return;
    const t = lastMessage.type;
    if (t === 'task_assignee_completed') {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/verification-queue'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/broadcast-summary'] });
    }
    if (t === 'task_assignee_status_changed' || t === 'task_assignee_broadcast' || t === 'task_broadcast') {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/verification-queue'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/broadcast-summary'] });
    }
  }, [lastMessage, queryClient]);

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const canManageTasks = userPermissions?.some?.(p =>
    p.name === 'tasks.edit_all' || p.name === 'tasks.create' || p.name === 'admin.manage_all'
  ) || isAdmin || false;

  // Stricter check matching backend manager guards: admin.manage_all OR hr.manage_employees
  const canBroadcast = userPermissions?.some?.(p =>
    p.name === 'admin.manage_all' || p.name === 'hr.manage_employees'
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
      return res.json() as Promise<Task>;
    },
    onSuccess: async (createdTask) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      setShowCreateDialog(false);
      setForm(emptyForm);
      if (broadcastAfterCreate) {
        setBroadcastAfterCreate(false);
        // Immediately broadcast to all clocked-in employees
        try {
          const bRes = await apiRequest('POST', `/api/tasks/${createdTask.id}/broadcast`, {});
          const bData = await bRes.json() as { count?: number };
          const count = bData.count ?? 0;
          toast({
            title: "Task Created & Broadcast!",
            description: count === 0
              ? "Task created, but no employees are currently clocked in."
              : `Task created and assigned to ${count} clocked-in employee${count !== 1 ? 's' : ''}.`,
          });
        } catch {
          toast({ title: "Task Created", description: "Task saved. Broadcast failed — try again from the task list." });
        }
      } else {
        toast({ title: "Task Created", description: "Task has been created successfully." });
      }
    },
    onError: (error) => {
      setBroadcastAfterCreate(false);
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

  const { data: clockedInCount = 0 } = useQuery<number>({
    queryKey: ['/api/tasks/clocked-in-count'],
    select: (d: any) => d?.count ?? 0,
    refetchInterval: 30000,
    enabled: canBroadcast,
  });

  const { data: verificationQueue = [], refetch: refetchQueue } = useQuery<VerificationItem[]>({
    queryKey: ['/api/tasks/verification-queue'],
    enabled: canBroadcast,
    refetchInterval: 15000,
  });

  // Broadcast summary for ALL tasks — used to show progress bars in the task list (managers only)
  const { data: broadcastSummary = {} } = useQuery<Record<string, { total: number; approved: number }>>({
    queryKey: ['/api/tasks/broadcast-summary'],
    enabled: canBroadcast,
    refetchInterval: 15000,
  });

  // Broadcast progress for the currently viewed task (manager detail modal — detailed breakdown)
  const { data: broadcastProgress } = useQuery<{ total: number; approved: number; completed: number; in_progress: number; pending: number; rejected: number }>({
    queryKey: ['/api/tasks', viewingTask?.id, 'broadcast-progress'],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${viewingTask!.id}/broadcast-progress`, { credentials: 'include' });
      return res.json();
    },
    enabled: !!viewingTask && canBroadcast,
    refetchInterval: 10000,
  });

  const broadcastMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiRequest('POST', `/api/tasks/${taskId}/broadcast`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      setBroadcastingTask(null);
      const count = data.count ?? 0;
      if (count === 0) {
        toast({ title: "No one clocked in", description: "No employees are currently clocked in." });
      } else {
        toast({ title: "Task Broadcast!", description: `Assigned to ${count} clocked-in employee${count !== 1 ? 's' : ''}.` });
      }
      refetchQueue();
    },
    onError: (err: Error) => toast({ title: "Broadcast Failed", description: err.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ taskId, assigneeId }: { taskId: string; assigneeId: string }) => {
      const res = await apiRequest('PATCH', `/api/tasks/${taskId}/assignees/${assigneeId}/approve`, {});
      return res.json() as Promise<{ assignee: TaskAssignee; streak: number }>;
    },
    onSuccess: (data) => {
      refetchQueue();
      const streak = data?.streak ?? 0;
      toast({
        title: streak >= 2 ? `🔥 ${streak}× Streak! Approved!` : "Approved!",
        description: streak >= 2
          ? `They've completed this task perfectly ${streak} times in a row.`
          : "Task completion approved.",
      });
    },
    onError: (err: Error) => toast({ title: "Approval Failed", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ taskId, assigneeId, note }: { taskId: string; assigneeId: string; note: string }) => {
      const res = await apiRequest('PATCH', `/api/tasks/${taskId}/assignees/${assigneeId}/reject`, { rejectionNote: note });
      return res.json();
    },
    onSuccess: () => {
      setRejectingItem(null);
      setRejectionNote('');
      refetchQueue();
      toast({ title: "Rejected", description: "Employee notified to redo the task." });
    },
    onError: (err: Error) => toast({ title: "Reject Failed", description: err.message, variant: "destructive" }),
  });

  const aiAssignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/ai/assign-chores', {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      if (data.message === 'No unassigned chores available') {
        toast({ title: "No Tasks to Assign", description: "All tasks are already assigned or none are pending." });
      } else {
        const count = data.assignments?.length || 0;
        const uniqueEmployees = new Set(data.assignments?.map((a: any) => a.assignedTo) || []).size;
        toast({
          title: "AI Auto-Assign Complete",
          description: `${count} task${count !== 1 ? 's' : ''} assigned to ${uniqueEmployees} employee${uniqueEmployees !== 1 ? 's' : ''}`,
        });
      }
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to auto-assign tasks: ${error.message}`, variant: "destructive" });
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
    if (filterAIAssign === 'ai' && !task.isAIAssigned) return false;
    if (filterAIAssign === 'manual' && task.isAIAssigned) return false;
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
          <div className="flex items-center gap-2">
            {canManageTasks && (
              <Button
                onClick={() => aiAssignMutation.mutate()}
                disabled={aiAssignMutation.isPending}
                variant="outline"
                className="border-primary/50 text-primary hover:bg-primary/10"
                data-testid="ai-auto-assign-btn"
              >
                {aiAssignMutation.isPending ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>AI is distributing tasks...</>
                ) : (
                  <><i className="fas fa-magic mr-2"></i>AI Auto-Assign</>
                )}
              </Button>
            )}
            {canManageTasks && (
              <Button onClick={openCreate} data-testid="create-task-btn">
                <i className="fas fa-plus mr-2"></i>New Task
              </Button>
            )}
          </div>
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
          <TabsList className={`grid w-full ${canBroadcast ? 'grid-cols-5' : 'grid-cols-4'}`}>
            <TabsTrigger value="all">All Tasks</TabsTrigger>
            <TabsTrigger value="recurring">Recurring</TabsTrigger>
            <TabsTrigger value="one-time">One-Time</TabsTrigger>
            <TabsTrigger value="my-tasks">My Tasks</TabsTrigger>
            {canBroadcast && (
              <TabsTrigger value="verification" className="relative">
                Verify
                {verificationQueue.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    {verificationQueue.length}
                  </span>
                )}
              </TabsTrigger>
            )}
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
              <Select value={filterAIAssign} onValueChange={setFilterAIAssign}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="AI Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="ai">AI Assigned</SelectItem>
                  <SelectItem value="manual">Manually Assigned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {activeTab !== 'verification' && (
            <p className="text-sm text-muted-foreground">{filteredTasks.length} tasks found</p>
            )}

            {activeTab !== 'verification' && (
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
                    <Card
                      key={task.id}
                      className="hover:shadow-sm transition-shadow cursor-pointer"
                      data-testid={`task-card-${task.id}`}
                      onClick={() => canManageTasks ? openEdit(task) : setViewingTask(task)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); statusMutation.mutate({
                              id: task.id,
                              status: task.status === 'completed' ? 'pending' : 'completed'
                            }); }}
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
                                {task.isAIAssigned && task.aiReasoning && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <p className="text-xs text-primary/70 mt-0.5 cursor-help flex items-center gap-1">
                                          <i className="fas fa-brain text-[10px]"></i>
                                          <span className="line-clamp-1">{task.aiReasoning}</span>
                                        </p>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom" className="max-w-xs">
                                        <p className="text-xs"><strong>AI Reasoning:</strong> {task.aiReasoning}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                {task.completionImageUrl && (
                                  <div className="mt-2">
                                    <img 
                                      src={task.completionImageUrl} 
                                      alt="Completion" 
                                      className="w-20 h-20 object-cover rounded-md border cursor-pointer hover:opacity-80 transition-opacity"
                                      onClick={(e) => { e.stopPropagation(); window.open(task.completionImageUrl!, '_blank'); }}
                                    />
                                  </div>
                                )}
                                {/* Compact broadcast progress bar — shown when this task has been broadcast */}
                                {canBroadcast && broadcastSummary[task.id] && broadcastSummary[task.id].total > 0 && (
                                  <div className="mt-2" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <span className="text-[10px] text-primary font-medium">Broadcast</span>
                                      <span className="text-[10px] text-muted-foreground">
                                        {broadcastSummary[task.id].approved}/{broadcastSummary[task.id].total} approved
                                      </span>
                                    </div>
                                    <Progress
                                      value={(broadcastSummary[task.id].approved / broadcastSummary[task.id].total) * 100}
                                      className="h-1"
                                    />
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                {canBroadcast && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-primary border-primary/40 hover:bg-primary/10"
                                    disabled={broadcastMutation.isPending && broadcastingTask?.id === task.id}
                                    onClick={() => setBroadcastingTask(task)}
                                    title={`Assign to all clocked-in (${clockedInCount})`}
                                  >
                                    {broadcastMutation.isPending && broadcastingTask?.id === task.id
                                      ? <i className="fas fa-spinner fa-spin"></i>
                                      : <><i className="fas fa-broadcast-tower mr-1 text-xs"></i><span className="text-xs">{clockedInCount}</span></>
                                    }
                                  </Button>
                                )}
                                {task.assignedTo === user?.id && task.status !== 'completed' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => {
                                      const input = document.createElement('input');
                                      input.type = 'file';
                                      input.accept = 'image/*';
                                      input.capture = 'environment';
                                      input.onchange = async (e) => {
                                        const file = (e.target as HTMLInputElement).files?.[0];
                                        if (file) {
                                          const reader = new FileReader();
                                          reader.onloadend = async () => {
                                            const base64String = reader.result as string;
                                            try {
                                              await apiRequest('POST', `/api/tasks/${task.id}/image`, { imageUrl: base64String });
                                              queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
                                              toast({ title: "Image Uploaded", description: "Task completion photo has been saved." });
                                            } catch (err) {
                                              toast({ title: "Upload Failed", variant: "destructive" });
                                            }
                                          };
                                          reader.readAsDataURL(file);
                                        }
                                      };
                                      input.click();
                                    }}
                                  >
                                    <i className="fas fa-camera mr-1"></i> Photo
                                  </Button>
                                )}
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
                              {task.isAIAssigned && (
                                <Badge className="text-[10px] bg-primary/15 text-primary border border-primary/30">
                                  <i className="fas fa-robot mr-1"></i>AI Assigned
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
                                  <div onClick={e => e.stopPropagation()}>
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
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{getUserName(task.assignedTo)}</span>
                                )}
                              </div>
                              {canManageTasks && task.status !== 'completed' && (
                                <div onClick={e => e.stopPropagation()}>
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
                                </div>
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
            )}

            {canBroadcast && (
              <TabsContent value="verification" className="mt-0">
                {verificationQueue.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <i className="fas fa-clipboard-check text-4xl text-muted-foreground/30 mb-3"></i>
                      <p className="text-muted-foreground">No completions awaiting verification.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {verificationQueue.map(({ assignee, task, user: emp, streak }) => {
                      const completedMins = assignee.completedAt && assignee.startedAt
                        ? Math.round((new Date(assignee.completedAt).getTime() - new Date(assignee.startedAt).getTime()) / 60000)
                        : null;
                      return (
                        <Card key={assignee.id} className="border-amber-200 dark:border-amber-800/50">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              {emp.profileImageUrl ? (
                                <img src={emp.profileImageUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                                  <i className="fas fa-user text-primary text-sm"></i>
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="font-medium text-sm">{emp.firstName} {emp.lastName}</p>
                                      {streak >= 2 && (
                                        <Badge className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-1.5">
                                          🔥 {streak}× streak
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{task.title}</p>
                                    {completedMins !== null && (
                                      <p className="text-xs text-muted-foreground mt-0.5">
                                        <i className="fas fa-clock mr-1"></i>{completedMins}m to complete
                                      </p>
                                    )}
                                    {assignee.completionNote && (
                                      <p className="text-xs italic text-muted-foreground mt-1">"{assignee.completionNote}"</p>
                                    )}
                                  </div>
                                  <div className="flex gap-2 flex-shrink-0">
                                    <Button
                                      size="sm"
                                      className="h-8 bg-green-600 hover:bg-green-700 text-white"
                                      disabled={approveMutation.isPending}
                                      onClick={() => approveMutation.mutate({ taskId: task.id, assigneeId: assignee.id })}
                                    >
                                      <i className="fas fa-check mr-1"></i>Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-8"
                                      onClick={() => { setRejectingItem({ assignee, task, user: emp }); setRejectionNote(''); }}
                                    >
                                      <i className="fas fa-times mr-1"></i>Redo
                                    </Button>
                                  </div>
                                </div>

                                {(assignee.completionImageUrl || assignee.previousImageUrl) && (
                                  <div className="mt-3 grid grid-cols-2 gap-2">
                                    {assignee.previousImageUrl && (
                                      <div>
                                        <p className="text-[10px] text-muted-foreground mb-1 text-center">Last Approved</p>
                                        <img
                                          src={assignee.previousImageUrl}
                                          alt="Last approved"
                                          className="w-full h-28 object-cover rounded-lg border opacity-80 cursor-pointer hover:opacity-100"
                                          onClick={() => window.open(assignee.previousImageUrl!, '_blank')}
                                        />
                                      </div>
                                    )}
                                    {assignee.completionImageUrl && (
                                      <div>
                                        <p className="text-[10px] text-muted-foreground mb-1 text-center">Just Submitted</p>
                                        <img
                                          src={assignee.completionImageUrl}
                                          alt="Completion"
                                          className="w-full h-28 object-cover rounded-lg border cursor-pointer hover:opacity-80"
                                          onClick={() => window.open(assignee.completionImageUrl!, '_blank')}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            )}
          </div>
        </Tabs>
      </div>

      {/* Broadcast confirmation dialog */}
      <Dialog open={!!broadcastingTask} onOpenChange={(open) => { if (!open) setBroadcastingTask(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <i className="fas fa-broadcast-tower text-primary"></i>
              Broadcast Task
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm">Assign <strong>{broadcastingTask?.title}</strong> to all currently clocked-in employees?</p>
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-primary">{clockedInCount}</p>
              <p className="text-xs text-muted-foreground">employees clocked in right now</p>
            </div>
            {clockedInCount === 0 && (
              <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                <i className="fas fa-exclamation-triangle mr-1"></i>No employees are currently clocked in.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBroadcastingTask(null)}>Cancel</Button>
            <Button
              onClick={() => broadcastingTask && broadcastMutation.mutate(broadcastingTask.id)}
              disabled={broadcastMutation.isPending || clockedInCount === 0}
              className="bg-primary"
            >
              {broadcastMutation.isPending
                ? <><i className="fas fa-spinner fa-spin mr-2"></i>Broadcasting...</>
                : <><i className="fas fa-broadcast-tower mr-2"></i>Assign to All ({clockedInCount})</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject / Redo dialog */}
      <Dialog open={!!rejectingItem} onOpenChange={(open) => { if (!open) { setRejectingItem(null); setRejectionNote(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request Redo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell <strong>{rejectingItem?.user.firstName}</strong> what needs to be improved on <strong>{rejectingItem?.task.title}</strong>.
            </p>
            <Textarea
              placeholder="e.g. Shelves still have dust, please redo..."
              value={rejectionNote}
              onChange={e => setRejectionNote(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectingItem(null); setRejectionNote(''); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending}
              onClick={() => rejectingItem && rejectMutation.mutate({
                taskId: rejectingItem.task.id,
                assigneeId: rejectingItem.assignee.id,
                note: rejectionNote,
              })}
            >
              {rejectMutation.isPending ? 'Sending...' : 'Request Redo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditingTask(null); setForm(emptyForm); }}>
              Cancel
            </Button>
            {/* Broadcast shortcut — only shown for new tasks, only to managers */}
            {!editingTask && canManageTasks && (
              <Button
                variant="outline"
                className="border-primary/50 text-primary hover:bg-primary/10"
                disabled={!form.title || createMutation.isPending}
                onClick={() => { setBroadcastAfterCreate(true); handleCreateOrEdit(); }}
                title={`Create and assign to all clocked-in (${clockedInCount})`}
              >
                <i className="fas fa-broadcast-tower mr-2 text-xs"></i>
                Create & Broadcast ({clockedInCount})
              </Button>
            )}
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

      <Dialog open={!!viewingTask} onOpenChange={(open) => { if (!open) setViewingTask(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <i className="fas fa-clipboard-list text-primary"></i>
              Task Details
            </DialogTitle>
          </DialogHeader>
          {viewingTask && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Title</p>
                <p className="font-medium">{viewingTask.title}</p>
              </div>
              {/* Broadcast progress bar — shown when there are broadcast assignees */}
              {canBroadcast && broadcastProgress && broadcastProgress.total > 0 && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-medium text-primary">Broadcast Progress</p>
                    <p className="text-xs text-muted-foreground">
                      {broadcastProgress.approved} / {broadcastProgress.total} approved
                    </p>
                  </div>
                  <Progress
                    value={broadcastProgress.total > 0 ? (broadcastProgress.approved / broadcastProgress.total) * 100 : 0}
                    className="h-2"
                  />
                  <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                    {broadcastProgress.pending > 0 && <span><i className="fas fa-clock mr-0.5"></i>{broadcastProgress.pending} pending</span>}
                    {broadcastProgress.in_progress > 0 && <span className="text-blue-600"><i className="fas fa-play mr-0.5"></i>{broadcastProgress.in_progress} in progress</span>}
                    {broadcastProgress.completed > 0 && <span className="text-amber-600"><i className="fas fa-check-circle mr-0.5"></i>{broadcastProgress.completed} awaiting review</span>}
                    {broadcastProgress.rejected > 0 && <span className="text-red-600"><i className="fas fa-redo-alt mr-0.5"></i>{broadcastProgress.rejected} redo required</span>}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                <p className="text-muted-foreground">{viewingTask.description || 'No description'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Status</p>
                  <Badge className={`text-[10px] ${STATUS_COLORS[viewingTask.status || 'pending']}`}>
                    {viewingTask.status?.replace('_', ' ') || 'pending'}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Priority</p>
                  {viewingTask.priority ? (
                    <Badge className={`text-[10px] ${PRIORITY_COLORS[viewingTask.priority]}`}>
                      {viewingTask.priority}
                    </Badge>
                  ) : (
                    <p className="text-muted-foreground">Not set</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Assigned To</p>
                  <p>{getUserName(viewingTask.assignedTo)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Day</p>
                  <p className="capitalize">{viewingTask.dayOfWeek || 'Any day'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Time</p>
                  <p className="capitalize">{viewingTask.timeOfDay || 'Any time'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Zone</p>
                  <p className="capitalize">{viewingTask.choreZone || 'No zone'}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Estimated Time</p>
                <p>{viewingTask.estimatedMinutes ? `${viewingTask.estimatedMinutes} minutes` : 'Not set'}</p>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {viewingTask.isRecurring ? (
                  <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700 dark:text-purple-400">
                    <i className="fas fa-sync-alt mr-1"></i>Recurring
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    <i className="fas fa-minus mr-1"></i>One-time
                  </Badge>
                )}
                {viewingTask.requiresSignature && (
                  <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700 dark:text-orange-400">
                    <i className="fas fa-signature mr-1"></i>Requires Sign-off
                  </Badge>
                )}
                {viewingTask.isAIAssigned && (
                  <Badge className="text-[10px] bg-primary/15 text-primary border border-primary/30">
                    <i className="fas fa-robot mr-1"></i>AI Assigned
                  </Badge>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingTask(null)}>Close</Button>
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
