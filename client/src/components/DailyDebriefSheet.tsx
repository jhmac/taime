import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Camera, X, Loader2, Sun, CloudRain, Sparkles } from 'lucide-react';

interface DailyDebriefSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DailyDebriefSheet({ open, onOpenChange }: DailyDebriefSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [whatWentWell, setWhatWentWell] = useState('');
  const [whatBuggedYou, setWhatBuggedYou] = useState('');
  const [customerHighlights, setCustomerHighlights] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const resetForm = useCallback(() => {
    setWhatWentWell('');
    setWhatBuggedYou('');
    setCustomerHighlights('');
    setPhotoUrl(null);
    setSubmitted(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/rituals/debrief', {
        whatWentWell: whatWentWell.trim() || null,
        whatBuggedYou: whatBuggedYou.trim() || null,
        whatBuggedYouPhotoUrl: photoUrl || null,
        customerHighlights: customerHighlights.trim() || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/rituals/debrief'] });
      setSubmitted(true);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save debrief', variant: 'destructive' });
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

  const hasContent = whatWentWell.trim() || whatBuggedYou.trim() || customerHighlights.trim();
  const firstName = user?.firstName || 'there';

  return (
    <Sheet open={open} onOpenChange={(val) => { if (!val) resetForm(); onOpenChange(val); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-auto">
        {submitted ? (
          <div className="py-12 text-center space-y-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="text-5xl">&#128075;</div>
            <h2 className="text-xl font-bold">Thanks for reflecting today, {firstName}!</h2>
            <p className="text-muted-foreground">See you next time.</p>
            <Button
              variant="outline"
              className="mt-4 rounded-full"
              onClick={() => { resetForm(); onOpenChange(false); }}
            >
              Close
            </Button>
          </div>
        ) : (
          <>
            <SheetHeader className="pb-2">
              <SheetTitle className="text-lg flex items-center gap-2">
                <Sun className="h-5 w-5 text-amber-500" />
                Daily Debrief
              </SheetTitle>
              <p className="text-sm text-muted-foreground">Take a moment to reflect on your day. Everything is optional.</p>
            </SheetHeader>

            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-green-500" />
                  What went well today?
                </label>
                <Textarea
                  placeholder="Any wins, good moments, or things that clicked?"
                  value={whatWentWell}
                  onChange={e => setWhatWentWell(e.target.value)}
                  className="min-h-[80px] text-sm bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-900 focus:border-green-400 resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <CloudRain className="h-4 w-4 text-orange-500" />
                  What bugged you?
                </label>
                <Textarea
                  placeholder="Anything that felt frustrating, slow, or broken?"
                  value={whatBuggedYou}
                  onChange={e => setWhatBuggedYou(e.target.value)}
                  className="min-h-[80px] text-sm bg-orange-50/50 dark:bg-orange-950/10 border-orange-200 dark:border-orange-900 focus:border-orange-400 resize-none"
                />
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhotoCapture}
                  />
                  {photoUrl ? (
                    <div className="relative rounded-lg overflow-hidden border mt-2">
                      <img src={photoUrl} alt="Evidence" className="w-full max-h-28 object-cover" />
                      <Button
                        variant="destructive"
                        size="sm"
                        className="absolute top-1 right-1 h-7 w-7 p-0"
                        onClick={() => { setPhotoUrl(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs border-dashed"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Add Photo
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Sun className="h-4 w-4 text-blue-500" />
                  Customer highlights
                </label>
                <Textarea
                  placeholder="Any memorable customer moments?"
                  value={customerHighlights}
                  onChange={e => setCustomerHighlights(e.target.value)}
                  className="min-h-[80px] text-sm bg-blue-50/50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-900 focus:border-blue-400 resize-none"
                />
              </div>

              <Button
                className="w-full min-h-[48px] text-base font-semibold rounded-xl"
                disabled={!hasContent || submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                Save & Head Out
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
