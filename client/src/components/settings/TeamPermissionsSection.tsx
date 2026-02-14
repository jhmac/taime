import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, ExternalLink } from 'lucide-react';
import { useLocation } from 'wouter';

export default function TeamPermissionsSection() {
  const [, navigate] = useLocation();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">Manage roles and permissions for your team members in the dedicated role management page.</p>
          <Button onClick={() => navigate('/hr/roles')} className="gap-2">
            <Shield className="w-4 h-4" /> Manage Roles & Permissions <ExternalLink className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
