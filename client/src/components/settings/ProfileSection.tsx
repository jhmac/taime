import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { User } from 'lucide-react';
import type { ProfileSectionProps } from '@/components/settings/types';

export default function ProfileSection({ user }: ProfileSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {user?.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <User className="w-8 h-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="font-medium">{user?.firstName} {user?.lastName}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">First name</Label>
              <p className="text-sm">{user?.firstName || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Last name</Label>
              <p className="text-sm">{user?.lastName || '—'}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <p className="text-sm">{user?.email || '—'}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Profile editing is managed through your authentication provider.</p>
        </CardContent>
      </Card>
    </div>
  );
}
