import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import PayrollModal from '@/components/PayrollModal';

export default function HR() {
  const { user } = useAuth();
  const [showPayrollModal, setShowPayrollModal] = useState(false);

  const { data: timeEntries, isLoading: timeEntriesLoading } = useQuery({
    queryKey: ['/api/time-entries'],
  });

  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  const thisWeekEntries = timeEntries?.filter((entry: any) => {
    const entryDate = new Date(entry.clockInTime);
    return entryDate >= startOfWeek;
  }) || [];

  const totalHoursThisWeek = thisWeekEntries.reduce((total: number, entry: any) => {
    if (entry.clockOutTime) {
      const clockIn = new Date(entry.clockInTime);
      const clockOut = new Date(entry.clockOutTime);
      const hours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
      const breakHours = (entry.breakMinutes || 0) / 60;
      return total + (hours - breakHours);
    }
    return total;
  }, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">HR Hub</h1>
            <p className="text-sm opacity-80">Performance & payroll management</p>
          </div>
          <Link href="/hr/roles">
            <Button variant="secondary" size="sm" data-testid="button-role-management">
              <i className="fas fa-users-cog mr-2"></i>
              Role Management
            </Button>
          </Link>
        </div>
      </header>

      <div className="p-4">
        <Tabs defaultValue="performance" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="policies">Policies</TabsTrigger>
          </TabsList>

          <TabsContent value="performance" className="space-y-4">
            {/* Performance Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-chart-line text-primary mr-2"></i>
                  Performance Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">95%</p>
                    <p className="text-xs text-muted-foreground">Attendance Rate</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">4.8</p>
                    <p className="text-xs text-muted-foreground">Performance Score</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Task Completion Rate</span>
                      <span>92%</span>
                    </div>
                    <Progress value={92} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Punctuality Score</span>
                      <span>88%</span>
                    </div>
                    <Progress value={88} className="h-2" />
                  </div>
                  
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Team Collaboration</span>
                      <span>96%</span>
                    </div>
                    <Progress value={96} className="h-2" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recent Achievements */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-trophy text-primary mr-2"></i>
                  Recent Achievements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <i className="fas fa-medal text-green-600"></i>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-green-800">Perfect Week</p>
                      <p className="text-xs text-green-700">Completed all tasks on time this week</p>
                    </div>
                    <Badge className="bg-green-100 text-green-800">+10 pts</Badge>
                  </div>
                  
                  <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <i className="fas fa-clock text-blue-600"></i>
                    <div className="flex-1">
                      <p className="font-medium text-sm text-blue-800">Early Bird</p>
                      <p className="text-xs text-blue-700">Clocked in early 5 days in a row</p>
                    </div>
                    <Badge className="bg-blue-100 text-blue-800">+5 pts</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll" className="space-y-4">
            {/* Current Period Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-dollar-sign text-primary mr-2"></i>
                  Current Pay Period
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Week of Jan 20-24, 2025</span>
                    <Badge variant={totalHoursThisWeek > 40 ? "destructive" : "default"}>
                      {totalHoursThisWeek.toFixed(1)} hours
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Regular Hours</p>
                      <p className="font-semibold" data-testid="regular-hours">
                        {Math.min(40, totalHoursThisWeek).toFixed(1)}h
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Overtime</p>
                      <p className="font-semibold" data-testid="overtime-hours">
                        {Math.max(0, totalHoursThisWeek - 40).toFixed(1)}h
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Hourly Rate</p>
                      <p className="font-semibold" data-testid="hourly-rate">
                        ${user?.hourlyRate || '18.50'}/hr
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Est. Total</p>
                      <p className="font-semibold" data-testid="estimated-pay">
                        ${((user?.hourlyRate ? parseFloat(user.hourlyRate) : 18.50) * totalHoursThisWeek).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => setShowPayrollModal(true)}
                    className="w-full"
                    data-testid="review-timesheet-button"
                  >
                    <i className="fas fa-file-invoice-dollar mr-2"></i>
                    Review Timesheet
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Timesheet History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timesheet History</CardTitle>
              </CardHeader>
              <CardContent>
                {timeEntriesLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
                    ))}
                  </div>
                ) : thisWeekEntries.length === 0 ? (
                  <div className="text-center py-4">
                    <i className="fas fa-calendar text-muted-foreground text-xl mb-2"></i>
                    <p className="text-muted-foreground text-sm">No time entries this week</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {thisWeekEntries.map((entry: any) => (
                      <div key={entry.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div>
                          <p className="font-medium text-sm">
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
                            <p className="font-medium text-sm">
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
                          {entry.isApproved && (
                            <i className="fas fa-check-circle text-green-500 text-xs ml-2"></i>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            {/* Company Policies */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-file-contract text-primary mr-2"></i>
                  Company Policies
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Employee Handbook</p>
                      <p className="text-xs text-muted-foreground">Updated Jan 2025 • 42 pages</p>
                    </div>
                  </Button>
                  
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Time Off Policy</p>
                      <p className="text-xs text-muted-foreground">Vacation, sick leave, and PTO guidelines</p>
                    </div>
                  </Button>
                  
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Safety Procedures</p>
                      <p className="text-xs text-muted-foreground">Workplace safety and emergency protocols</p>
                    </div>
                  </Button>
                  
                  <Button variant="ghost" className="w-full justify-start h-auto p-3">
                    <div className="text-left">
                      <p className="font-medium text-sm">Code of Conduct</p>
                      <p className="text-xs text-muted-foreground">Professional behavior guidelines</p>
                    </div>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Training Resources */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-graduation-cap text-primary mr-2"></i>
                  Training & Development
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-play text-blue-600 text-xs"></i>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Safety Training</p>
                        <p className="text-xs text-muted-foreground">Complete by Feb 1st</p>
                      </div>
                    </div>
                    <Badge className="bg-yellow-100 text-yellow-800">In Progress</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-check text-green-600 text-xs"></i>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Time Clock Training</p>
                        <p className="text-xs text-muted-foreground">Completed Jan 15th</p>
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-800">Complete</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <i className="fas fa-book text-gray-600 text-xs"></i>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Customer Service Excellence</p>
                        <p className="text-xs text-muted-foreground">Available</p>
                      </div>
                    </div>
                    <Badge variant="outline">Available</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">This Month's Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Tasks Completed</span>
                    <span className="font-medium">24/26</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>On-Time Clock-ins</span>
                    <span className="font-medium">18/20</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Team Feedback Score</span>
                    <span className="font-medium">4.8/5.0</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll" className="space-y-4">
            {/* Current Pay Period */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-money-check-alt text-primary mr-2"></i>
                  Current Pay Period
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">Week of Jan 20-24, 2025</span>
                    <Badge>{totalHoursThisWeek.toFixed(1)} hours</Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Hours</p>
                      <p className="font-semibold">{totalHoursThisWeek.toFixed(1)}h</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Overtime</p>
                      <p className="font-semibold text-orange-600">
                        {Math.max(0, totalHoursThisWeek - 40).toFixed(1)}h
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Regular Rate</p>
                      <p className="font-semibold">${user?.hourlyRate || '18.50'}/hr</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Est. Total</p>
                      <p className="font-semibold">
                        ${((user?.hourlyRate ? parseFloat(user.hourlyRate) : 18.50) * totalHoursThisWeek).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={() => setShowPayrollModal(true)}
                  className="w-full"
                  data-testid="open-payroll-modal"
                >
                  <i className="fas fa-file-invoice mr-2"></i>
                  Review Timesheet with AI
                </Button>
              </CardContent>
            </Card>

            {/* Pay History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pay History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">Jan 13-17, 2025</p>
                      <p className="text-xs text-muted-foreground">38.5 hours • Approved</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">$712.25</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">Jan 6-10, 2025</p>
                      <p className="text-xs text-muted-foreground">40.0 hours • Approved</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">$740.00</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">Dec 30 - Jan 3, 2025</p>
                      <p className="text-xs text-muted-foreground">32.0 hours • Holiday week</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-sm">$592.00</p>
                      <p className="text-xs text-green-600">Paid</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="space-y-4">
            {/* Time Off Requests */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-calendar-plus text-primary mr-2"></i>
                  Time Off Requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" data-testid="request-time-off">
                  <i className="fas fa-plus mr-2"></i>
                  Request Time Off
                </Button>
                
                <div className="text-center py-4">
                  <i className="fas fa-calendar-check text-muted-foreground text-xl mb-2"></i>
                  <p className="text-muted-foreground text-sm">No pending requests</p>
                </div>
              </CardContent>
            </Card>

            {/* Available PTO */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Available Time Off</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">15</p>
                    <p className="text-xs text-muted-foreground">Vacation Days</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">8</p>
                    <p className="text-xs text-muted-foreground">Sick Days</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Benefits Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center">
                  <i className="fas fa-heart text-primary mr-2"></i>
                  Benefits Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Health Insurance</span>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Dental Coverage</span>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">401(k) Plan</span>
                    <Badge className="bg-blue-100 text-blue-800">Enrolled</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Life Insurance</span>
                    <Badge className="bg-green-100 text-green-800">Active</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Payroll Modal */}
      <PayrollModal
        isOpen={showPayrollModal}
        onClose={() => setShowPayrollModal(false)}
      />
    </div>
  );
}
