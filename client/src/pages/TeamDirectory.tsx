import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import type { User } from '@shared/schema';

export default function TeamDirectory() {
  const { user: currentUser } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['/api/users'],
  });

  const activeUsers = users
    .filter(u => u.isActive !== false)
    .filter(u => {
      if (!search) return true;
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      return name.includes(search.toLowerCase());
    })
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

  const getInitials = (first: string, last: string) =>
    `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();

  const getDaysAgo = (dateStr: string | null) => {
    if (!dateStr) return null;
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => navigate('/more')} className="text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-lg font-bold">Team</h1>
        <div className="w-6"></div>
      </div>

      <div className="p-4 pb-2">
        <div className="relative">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm"></i>
          <Input
            placeholder="Search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-muted/50"
          />
        </div>
      </div>

      <div className="px-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          </div>
        ) : (
          activeUsers.map(member => {
            const isYou = member.id === currentUser?.id;
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 py-3.5 border-b border-border"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                  {member.profileImageUrl ? (
                    <img src={member.profileImageUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    getInitials(member.firstName || '', member.lastName || '')
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {member.firstName} {member.lastName}
                    {isYou && <span className="text-muted-foreground"> (You)</span>}
                  </div>
                  {!isYou && member.createdAt && (
                    <div className="text-xs text-muted-foreground">
                      Invited {getDaysAgo(String(member.createdAt || ''))}
                    </div>
                  )}
                </div>
                {!isYou && (
                  <button
                    onClick={() => navigate('/communication')}
                    className="text-primary p-2"
                    title="Message"
                  >
                    <i className="fas fa-comment-dots text-lg"></i>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
