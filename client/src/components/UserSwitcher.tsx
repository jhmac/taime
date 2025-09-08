import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import type { UserWithRole } from '@shared/schema';

export default function UserSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth() as { user: UserWithRole | undefined, isLoading: boolean, isAuthenticated: boolean, error: any };

  const handleSwitchUser = () => {
    // Clear any local storage data
    localStorage.clear();
    sessionStorage.clear();
    
    // Redirect to logout which will clear server session and redirect to login
    window.location.href = '/api/auth/logout';
  };

  const handleLogout = () => {
    window.location.href = '/api/auth/logout';
  };

  if (!user) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="user-switcher-trigger">
          <i className="fas fa-user-circle mr-2"></i>
          {user.firstName} {user.lastName}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account Options</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current User</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <p className="font-medium">{user.firstName} {user.lastName}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
                {user.role && (
                  <p className="text-sm text-muted-foreground capitalize">Role: {user.role.displayName || user.role.name || 'Employee'}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Button 
              onClick={handleSwitchUser} 
              className="w-full" 
              variant="outline"
              data-testid="button-switch-user"
            >
              <i className="fas fa-user-friends mr-2"></i>
              Switch to Different User
            </Button>
            
            <Button 
              onClick={handleLogout} 
              className="w-full" 
              variant="destructive"
              data-testid="button-logout"
            >
              <i className="fas fa-sign-out-alt mr-2"></i>
              Log Out
            </Button>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded">
            <p>
              <strong>Switch User:</strong> Logs you out and redirects to the login page where you can sign in with a different Replit account.
            </p>
            <p className="mt-2">
              <strong>Log Out:</strong> Ends your current session and returns to the login page.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}