import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import {
  Plus, Search, ClipboardList, Clock, Play, CheckCircle2,
  ShieldCheck, Eye, Camera, GitBranch, Timer, ChevronRight
} from 'lucide-react';

interface SopTemplateListItem {
  id: string;
  storeId: string;
  title: string;
  description: string | null;
  category: string;
  estimatedDurationMinutes: number | null;
  roleAssignments: string[] | null;
  isActive: boolean | null;
  version: number;
  createdBy: string;
  createdAt: string;
  stepCount: number;
}

interface TemplateListResponse {
  success: boolean;
  data: SopTemplateListItem[];
  pagination: { total: number; limit: number; offset: number };
}

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'opening', label: 'Opening' },
  { value: 'closing', label: 'Closing' },
  { value: 'customer_service', label: 'Customer Service' },
  { value: 'visual_merchandising', label: 'Visual' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'safety', label: 'Safety' },
  { value: 'shift_handoff', label: 'Handoff' },
  { value: 'custom', label: 'Custom' },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  opening: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  closing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  customer_service: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  visual_merchandising: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  inventory: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  safety: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  shift_handoff: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  custom: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

function categoryLabel(cat: string) {
  return CATEGORIES.find(c => c.value === cat)?.label || cat;
}

export default function SOPLibrary() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  const isAdmin = user?.role?.name === 'admin' || user?.role?.name === 'owner';

  const queryParams = new URLSearchParams();
  if (category !== 'all') queryParams.set('category', category);
  if (searchDebounced) queryParams.set('search', searchDebounced);
  queryParams.set('limit', '50');
  const qs = queryParams.toString();

  const { data, isLoading } = useQuery<TemplateListResponse>({
    queryKey: ['/api/sops/templates', qs],
    queryFn: async () => {
      const res = await fetch(`/api/sops/templates?${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const templates = data?.data || [];

  let searchTimeout: ReturnType<typeof setTimeout>;
  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => setSearchDebounced(val), 300);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-4 pt-4 pb-2 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              SOP Library
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Standard Operating Procedures for your team</p>
          </div>
          {isAdmin && (
            <Button onClick={() => navigate('/sops/new')} className="gap-2">
              <Plus className="h-4 w-4" />
              Create SOP
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search procedures..."
            className="pl-9"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="w-full flex-wrap h-auto gap-1 bg-transparent p-0">
            {CATEGORIES.map(cat => (
              <TabsTrigger key={cat.value} value={cat.value} className="text-xs px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {cat.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-auto px-4 pb-4">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-20 bg-muted/20 rounded-2xl border-2 border-dashed mt-2">
            <ClipboardList className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No procedures yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              {isAdmin
                ? "Create your first SOP to help your team stay consistent and efficient."
                : "No procedures have been created for your team yet."}
            </p>
            {isAdmin && (
              <Button onClick={() => navigate('/sops/new')} className="mt-4 gap-2" variant="outline">
                <Plus className="h-4 w-4" />
                Create Your First SOP
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <Card
                key={t.id}
                className="cursor-pointer hover:shadow-md transition-all border hover:border-primary/30"
                onClick={() => navigate(`/sops/${t.id}`)}
              >
                <CardHeader className="pb-2 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight line-clamp-2">{t.title}</CardTitle>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  </div>
                  <Badge className={`w-fit text-[10px] ${CATEGORY_COLORS[t.category] || CATEGORY_COLORS.custom}`} variant="secondary">
                    {categoryLabel(t.category)}
                  </Badge>
                </CardHeader>
                <CardContent className="pt-0 pb-3">
                  {t.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{t.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t.stepCount} steps
                    </span>
                    {t.estimatedDurationMinutes && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {t.estimatedDurationMinutes} min
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[10px] opacity-60">
                      v{t.version}
                    </span>
                  </div>
                  {t.roleAssignments && t.roleAssignments.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {t.roleAssignments.map(r => (
                        <Badge key={r} variant="outline" className="text-[10px] px-1.5 py-0">{r}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
