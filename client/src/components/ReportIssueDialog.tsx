import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Wrench, RefreshCw, Users, Warehouse, Package, ShieldAlert,
  GraduationCap, HelpCircle, Camera, ImagePlus, X, Loader2, AlertTriangle, Send
} from 'lucide-react';

const CATEGORIES = [
  { value: 'equipment', label: 'Equipment', icon: Wrench },
  { value: 'process', label: 'Process', icon: RefreshCw },
  { value: 'customer_experience', label: 'Customer', icon: Users },
  { value: 'workspace', label: 'Workspace', icon: Warehouse },
  { value: 'inventory', label: 'Inventory', icon: Package },
  { value: 'safety', label: 'Safety', icon: ShieldAlert },
  { value: 'training', label: 'Training', icon: GraduationCap },
  { value: 'other', label: 'Other', icon: HelpCircle },
] as const;

const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700', dot: 'bg-green-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700', dot: 'bg-yellow-500' },
  { value: 'high', label: 'High', color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700', dot: 'bg-red-500' },
  { value: 'urgent', label: 'Urgent', color: 'bg-red-200 text-red-800 border-red-400 dark:bg-red-900/50 dark:text-red-300 dark:border-red-600', dot: 'bg-red-600 animate-pulse' },
] as const;

interface ReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function IssueForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/issues', {
        title: title.trim(),
        category,
        priority,
        description: description.trim() || undefined,
        photoUrl: photoUrl || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/issues'] });
      toast({ title: 'Issue reported!', description: 'Your manager has been notified.' });
      onSuccess();
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to report issue. Please try again.', variant: 'destructive' });
    },
  });

  const handlePhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);
        setPhotoUrl(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const canSubmit = title.trim().length > 0 && category.length > 0;

  return (
    <div className="space-y-4 px-1 pb-safe">
      <div>
        <Input
          placeholder="What's the problem?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="min-h-[48px] text-base"
          autoFocus
        />
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Category</p>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const selected = category === cat.value;
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all min-h-[64px] ${
                  selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-muted hover:border-muted-foreground/30 text-muted-foreground'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-tight text-center">{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Priority</p>
        <div className="flex gap-2">
          {PRIORITIES.map(p => {
            const selected = priority === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 transition-all text-sm font-medium min-h-[44px] ${
                  selected ? p.color + ' border-current' : 'border-muted text-muted-foreground hover:border-muted-foreground/30'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${selected ? p.dot : 'bg-muted-foreground/30'}`} />
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Textarea
          placeholder="Any details? (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="min-h-[60px] text-sm"
        />
      </div>

      <div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoCapture}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoCapture}
        />
        {photoUrl ? (
          <div className="relative rounded-xl overflow-hidden border-2 border-border">
            <img src={photoUrl} alt="Issue photo" className="w-full max-h-40 object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            <Button
              variant="destructive"
              size="sm"
              className="absolute top-2 right-2 h-7 w-7 p-0 shadow-md"
              onClick={() => {
                setPhotoUrl(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
                if (cameraInputRef.current) cameraInputRef.current.value = '';
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <p className="absolute bottom-2 left-2 text-[11px] text-white/80 font-medium">Photo attached</p>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 min-h-[48px] gap-2 border-dashed hover:border-primary/40 hover:bg-primary/5 transition-colors"
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Take Photo</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 min-h-[48px] gap-2 border-dashed hover:border-primary/40 hover:bg-primary/5 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Upload Image</span>
            </Button>
          </div>
        )}
      </div>

      <Button
        className="w-full min-h-[52px] text-base font-semibold gap-2 rounded-xl"
        disabled={!canSubmit || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending
          ? <Loader2 className="h-5 w-5 animate-spin" />
          : <Send className="h-4 w-4" />}
        {createMutation.isPending ? 'Submitting…' : 'Submit Issue'}
      </Button>
    </div>
  );
}

export default function ReportIssueDialog({ open, onOpenChange }: ReportIssueDialogProps) {
  const isMobile = useIsMobile();

  const handleSuccess = () => onOpenChange(false);

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="px-4 pb-6">
          <DrawerHeader className="pb-2 px-0">
            <DrawerTitle className="flex items-center gap-2 text-left">
              <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
              Report an Issue
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto max-h-[70vh]">
            <IssueForm onSuccess={handleSuccess} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Report an Issue
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <IssueForm onSuccess={handleSuccess} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
