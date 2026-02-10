import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { UserButton } from '@clerk/clerk-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import type { Permission } from '@shared/schema';

const allNavItems = [
  { path: '/', icon: 'fas fa-home', label: 'Dashboard' },
  { path: '/schedules', icon: 'fas fa-calendar-alt', label: 'Schedules' },
  { path: '/availability', icon: 'fas fa-clock', label: 'Availability' },
  { path: '/payroll', icon: 'fas fa-dollar-sign', label: 'Payroll', permission: 'admin.manage_payroll' },
  { path: '/team', icon: 'fas fa-users', label: 'Team', permission: 'hr.manage_employees' },
  { path: '/communication', icon: 'fas fa-comment', label: 'Communication' },
  { path: '/hr', icon: 'fas fa-user-tie', label: 'HR', permission: 'hr.manage_employees' },
  { path: '/operations', icon: 'fas fa-cogs', label: 'Operations', permission: 'admin.manage_all' },
];

export default function TopNavigation() {
  const [location, navigate] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  const { data: userPermissions = [] } = useQuery<Permission[]>({
    queryKey: ["/api/auth/permissions"],
    enabled: !!user,
  });

  const navItems = allNavItems.filter(item => {
    if (!item.permission) return true;
    return userPermissions?.some?.(p => p.name === item.permission) || false;
  });

  const handleNavigate = (path: string) => {
    navigate(path);
    setIsOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="menu-button">
                <i className="fas fa-bars"></i>
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80">
              <div className="flex flex-col space-y-4 py-4">
                <div className="px-3 py-2">
                  <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
                    ClockSync AI
                  </h2>
                  <div className="space-y-1">
                    {navItems.map((item) => (
                      <Button
                        key={item.path}
                        variant={location === item.path ? "secondary" : "ghost"}
                        className={cn(
                          "w-full justify-start",
                          location === item.path && "bg-muted font-medium"
                        )}
                        onClick={() => handleNavigate(item.path)}
                        data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
                      >
                        <i className={`${item.icon} mr-2`}></i>
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <h1 className="text-lg font-semibold">ClockSync AI</h1>
        </div>
        
        <div className="flex items-center gap-2">
          {user && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user.firstName} {user.lastName}
              </span>
              <UserButton afterSignOutUrl="/" />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}