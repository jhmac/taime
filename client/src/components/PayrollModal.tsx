import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { isUnauthorizedError } from '@/lib/authUtils';

interface PayrollModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PayrollModal({ isOpen, onClose }: PayrollModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aiMessage, setAiMessage] = useState('');
  const [showAIForm, setShowAIForm] = useState(false);

  const { data: timeEntries, isLoading: timeEntriesLoading } = useQuery({
    queryKey: ['/api/time-entries'],
    enabled: isOpen,
  });

  const analyzePayrollMutation = useMutation({
    mutationFn: async () => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // Last 7 days

      return await apiRequest('POST', '/api/payroll/analyze', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
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
        title: "Analysis Failed",
        description: "Failed to analyze payroll. Please try again.",
        variant: "destructive",
      });
    },
  });

  const aiChatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest('POST', '/api/ai/chat', { message });
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "AI Request Processed",
        description: data.response,
      });
      setAiMessage('');
      setShowAIForm(false);
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
        title: "AI Request Failed",
        description: "Failed to process AI request. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Calculate payroll data
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const thisWeekEntries = timeEntries?.filter((entry: any) => {
    const entryDate = new Date(entry.clockInTime);
    return entryDate >= startOfWeek;
  }) || [];

  const totalHours = thisWeekEntries.reduce((total: number, entry: any) => {
    if (entry.clockOutTime) {
      const clockIn = new Date(entry.clockInTime);
      const clockOut = new Date(entry.clockOutTime);
      const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
      const breakHours = (entry.breakMinutes || 0) / 60;
      return total + (hours - breakHours);
    }
    return total;
  }, 0);

  const regularHours = Math.min(40, totalHours);
  const overtimeHours = Math.max(0, totalHours - 40);
  const hourlyRate = user?.hourlyRate ? parseFloat(user.hourlyRate) : 18.50;
  const totalPay = (regularHours * hourlyRate) + (overtimeHours * hourlyRate * 1.5);

  const handleApproveAndSend = () => {
    toast({
      title: "Timesheet Approved",
      description: "Your timesheet has been approved and sent to accounting for payroll processing.",
    });
    onClose();
  };

  const handleAIRequest = () => {
    if (!aiMessage.trim()) return;
    
    const fullMessage = `Regarding my timesheet for this week (${totalHours.toFixed(1)} hours total, ${overtimeHours.toFixed(1)} overtime): ${aiMessage}`;
    aiChatMutation.mutate(fullMessage);
  };

  useEffect(() => {
    if (isOpen && !analyzePayrollMutation.data) {
      analyzePayrollMutation.mutate();
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto" data-testid="payroll-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <i className="fas fa-file-invoice-dollar text-primary mr-2"></i>
            Payroll Review
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Payroll Summary */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium mb-3">
                Week of {startOfWeek.toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                })} - {new Date().toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                })}
              </h3>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Hours</p>
                  <p className="font-semibold" data-testid="total-hours">
                    {totalHours.toFixed(1)}h
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Overtime</p>
                  <p className="font-semibold" data-testid="overtime-hours">
                    {overtimeHours.toFixed(1)}h
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Regular Rate</p>
                  <p className="font-semibold" data-testid="hourly-rate">
                    ${hourlyRate}/hr
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Est. Total Pay</p>
                  <p className="font-semibold" data-testid="total-pay">
                    ${totalPay.toFixed(2)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Analysis Results */}
          {analyzePayrollMutation.isLoading ? (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <i className="fas fa-spinner fa-spin text-primary"></i>
                  <span className="text-sm">Claude AI is analyzing your timesheet...</span>
                </div>
              </CardContent>
            </Card>
          ) : analyzePayrollMutation.data ? (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 mb-3">
                  <i className="fas fa-shield-check text-green-500"></i>
                  <span className="text-sm font-medium">AI Analysis Complete</span>
                </div>
                
                {analyzePayrollMutation.data.errors?.length > 0 ? (
                  <div className="space-y-2">
                    {analyzePayrollMutation.data.errors.map((error: any, index: number) => (
                      <div key={index} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2 mb-1">
                          <i className="fas fa-exclamation-triangle text-yellow-600"></i>
                          <span className="text-sm font-medium text-yellow-800">{error.type}</span>
                        </div>
                        <p className="text-xs text-yellow-700">{error.description}</p>
                        {error.suggestedFix && (
                          <p className="text-xs text-yellow-600 mt-1">
                            <strong>Suggestion:</strong> {error.suggestedFix}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center space-x-2 mb-2">
                      <i className="fas fa-check-circle text-green-600"></i>
                      <span className="text-sm font-medium text-green-800">No Issues Found</span>
                    </div>
                    <p className="text-xs text-green-700">
                      All clock-in/out times are within normal patterns. No overtime violations detected.
                    </p>
                  </div>
                )}

                {analyzePayrollMutation.data.recommendations?.length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-sm font-medium mb-2">Recommendations:</h4>
                    <ul className="space-y-1">
                      {analyzePayrollMutation.data.recommendations.map((rec: string, index: number) => (
                        <li key={index} className="text-xs text-muted-foreground">
                          • {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Time Entries */}
          <Card>
            <CardContent className="p-4">
              <h4 className="font-medium mb-3">Time Entries This Week</h4>
              {timeEntriesLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse h-12 bg-muted rounded-lg"></div>
                  ))}
                </div>
              ) : thisWeekEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No time entries this week
                </p>
              ) : (
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {thisWeekEntries.map((entry: any) => (
                    <div key={entry.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(entry.clockInTime).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.clockInTime).toLocaleTimeString('en-US', { hour12: true })}
                          {entry.clockOutTime && (
                            <> - {new Date(entry.clockOutTime).toLocaleTimeString('en-US', { hour12: true })}</>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        {entry.clockOutTime ? (
                          <p className="text-sm font-medium">
                            {(() => {
                              const clockIn = new Date(entry.clockInTime);
                              const clockOut = new Date(entry.clockOutTime);
                              const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
                              const breakHours = (entry.breakMinutes || 0) / 60;
                              return `${(hours - breakHours).toFixed(1)}h`;
                            })()}
                          </p>
                        ) : (
                          <Badge className="bg-green-100 text-green-800">Active</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="space-y-3">
            {!showAIForm ? (
              <div className="flex space-x-2">
                <Button
                  onClick={handleApproveAndSend}
                  className="flex-1"
                  data-testid="approve-timesheet"
                >
                  <i className="fas fa-check mr-2"></i>
                  Approve & Send
                </Button>
                <Button
                  onClick={() => setShowAIForm(true)}
                  variant="outline"
                  data-testid="ask-ai-changes"
                >
                  <i className="fas fa-robot mr-2"></i>
                  Ask AI
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Textarea
                  placeholder="Ask Claude AI to make changes to your timesheet..."
                  value={aiMessage}
                  onChange={(e) => setAiMessage(e.target.value)}
                  className="min-h-20"
                  data-testid="ai-message-input"
                />
                <div className="flex space-x-2">
                  <Button
                    onClick={handleAIRequest}
                    disabled={!aiMessage.trim() || aiChatMutation.isPending}
                    className="flex-1"
                    data-testid="send-ai-request"
                  >
                    {aiChatMutation.isPending ? (
                      <>
                        <i className="fas fa-spinner fa-spin mr-2"></i>
                        Processing...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-paper-plane mr-2"></i>
                        Send to Claude
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => setShowAIForm(false)}
                    variant="outline"
                    data-testid="cancel-ai-request"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
