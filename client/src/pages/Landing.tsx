import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Landing() {
  const handleLogin = () => {
    window.location.href = '/api/auth/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary rounded-full flex items-center justify-center">
            <i className="fas fa-robot text-primary-foreground text-2xl"></i>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">ClockSync AI</CardTitle>
            <CardDescription className="text-lg">
              AI-Powered Workforce Management
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <i className="fas fa-clock text-primary text-sm"></i>
              </div>
              <div>
                <p className="font-medium text-sm">Smart Time Tracking</p>
                <p className="text-xs text-muted-foreground">Geofenced clock-in/out with AI monitoring</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <i className="fas fa-brain text-primary text-sm"></i>
              </div>
              <div>
                <p className="font-medium text-sm">AI Task Assignment</p>
                <p className="text-xs text-muted-foreground">Claude AI optimizes workload distribution</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <i className="fas fa-chart-line text-primary text-sm"></i>
              </div>
              <div>
                <p className="font-medium text-sm">Smart Analytics</p>
                <p className="text-xs text-muted-foreground">Real-time insights and anomaly detection</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                <i className="fas fa-bell text-primary text-sm"></i>
              </div>
              <div>
                <p className="font-medium text-sm">Smart Notifications</p>
                <p className="text-xs text-muted-foreground">Location-based reminders and alerts</p>
              </div>
            </div>
          </div>

          <Button
            onClick={handleLogin}
            className="w-full"
            size="lg"
            data-testid="login-button"
          >
            <i className="fas fa-sign-in-alt mr-2"></i>
            Sign In to Get Started
          </Button>

          <div className="text-center text-xs text-muted-foreground">
            Secure login powered by Replit Auth
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
