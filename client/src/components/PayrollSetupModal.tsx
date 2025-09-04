import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, Users, Bot } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { User } from '@shared/schema';

interface PayrollSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PayrollSetupModal({ isOpen, onClose }: PayrollSetupModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [intervalType, setIntervalType] = useState<'weekly' | 'bi-weekly' | 'monthly'>('bi-weekly');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [enableAI, setEnableAI] = useState(false);
  const [notificationUserId, setNotificationUserId] = useState<string>('');
  const [useCalendar, setUseCalendar] = useState(true);
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');

  // Fetch users for notification selection
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: isOpen,
  });

  // Get eligible users (owners and managers)
  const eligibleUsers = users.filter(u => 
    u.roleId && ['owner', 'manager'].some(role => u.roleId?.includes(role))
  );

  const setupMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest('/api/payroll/setup', 'POST', data);
    },
    onSuccess: () => {
      toast({
        title: "Payroll Setup Complete",
        description: enableAI 
          ? "AI will now automatically manage future payroll periods and send notifications for verification."
          : "Payroll periods can now be managed manually.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/payroll'] });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Setup Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!startDate && !startDateInput) {
      toast({
        title: "Start Date Required",
        description: "Please select or enter a start date for the first pay period.",
        variant: "destructive",
      });
      return;
    }

    if (!endDate && !endDateInput) {
      toast({
        title: "End Date Required", 
        description: "Please select or enter an end date for the first pay period.",
        variant: "destructive",
      });
      return;
    }

    if (enableAI && !notificationUserId) {
      toast({
        title: "Notification User Required",
        description: "Please select who should receive payroll verification notifications when AI is enabled.",
        variant: "destructive",
      });
      return;
    }

    const finalStartDate = useCalendar ? startDate : new Date(startDateInput);
    const finalEndDate = useCalendar ? endDate : new Date(endDateInput);

    setupMutation.mutate({
      intervalType,
      firstPayPeriodStart: finalStartDate?.toISOString(),
      firstPayPeriodEnd: finalEndDate?.toISOString(),
      isAutomationEnabled: enableAI,
      notificationUserId: enableAI ? notificationUserId : null,
      isSetupComplete: true,
    });
  };

  // Calculate end date based on interval when start date changes
  const calculateEndDate = (start: Date) => {
    const end = new Date(start);
    switch (intervalType) {
      case 'weekly':
        end.setDate(start.getDate() + 6);
        break;
      case 'bi-weekly':
        end.setDate(start.getDate() + 13);
        break;
      case 'monthly':
        end.setMonth(start.getMonth() + 1);
        end.setDate(start.getDate() - 1);
        break;
    }
    return end;
  };

  // Auto-calculate end date when start date changes
  const handleStartDateChange = (date: Date | undefined) => {
    setStartDate(date);
    if (date && useCalendar) {
      setEndDate(calculateEndDate(date));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Payroll Setup - First Time Configuration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pay Period Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="interval">Pay Period Frequency</Label>
                <Select value={intervalType} onValueChange={(value: any) => setIntervalType(value)}>
                  <SelectTrigger data-testid="select-interval-type">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly (Every 7 days)</SelectItem>
                    <SelectItem value="bi-weekly">Bi-weekly (Every 14 days)</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="use-calendar" 
                  checked={useCalendar} 
                  onCheckedChange={(checked) => setUseCalendar(checked === true)}
                  data-testid="checkbox-use-calendar"
                />
                <Label htmlFor="use-calendar">Use calendar picker (uncheck to type dates)</Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Pay Period Start Date</Label>
                  {useCalendar ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !startDate && "text-muted-foreground"
                          )}
                          data-testid="button-start-date"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {startDate ? format(startDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={startDate}
                          onSelect={handleStartDateChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Input
                      type="date"
                      value={startDateInput}
                      onChange={(e) => setStartDateInput(e.target.value)}
                      data-testid="input-start-date"
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label>First Pay Period End Date</Label>
                  {useCalendar ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !endDate && "text-muted-foreground"
                          )}
                          data-testid="button-end-date"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {endDate ? format(endDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={endDate}
                          onSelect={setEndDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Input
                      type="date"
                      value={endDateInput}
                      onChange={(e) => setEndDateInput(e.target.value)}
                      data-testid="input-end-date"
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Automation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox 
                  id="enable-ai" 
                  checked={enableAI} 
                  onCheckedChange={(checked) => setEnableAI(checked === true)}
                  data-testid="checkbox-enable-ai"
                />
                <div className="space-y-1">
                  <Label htmlFor="enable-ai" className="text-base font-medium">
                    Let AI take over from now on
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    AI will automatically create future payroll periods, generate schedules, 
                    and send them for verification. You can always disable this later.
                  </p>
                </div>
              </div>

              {enableAI && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Who should receive payroll verification notifications?</Label>
                    <Select value={notificationUserId} onValueChange={setNotificationUserId}>
                      <SelectTrigger data-testid="select-notification-user">
                        <SelectValue placeholder="Select user to notify" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleUsers.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4" />
                              {user.firstName} {user.lastName}
                              <span className="text-muted-foreground">({user.email})</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                      What happens when AI automation is enabled:
                    </h4>
                    <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                      <li>• AI automatically creates new payroll periods based on your schedule</li>
                      <li>• Team members receive availability requests before each period</li>
                      <li>• AI generates optimized schedules based on availability and business needs</li>
                      <li>• Payroll summaries are sent to the selected user for verification</li>
                      <li>• Conflicts and issues are automatically flagged for review</li>
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end space-x-3">
            <Button 
              variant="outline" 
              onClick={onClose}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={setupMutation.isPending}
              data-testid="button-setup-payroll"
            >
              {setupMutation.isPending ? "Setting up..." : "Complete Setup"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}