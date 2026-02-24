import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { ShieldCheck, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react';

interface SOPSignOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionId: string;
  templateId: string;
  stepCompletionId: string;
  stepTitle: string;
  employeeName: string;
  photoUrl?: string | null;
}

export default function SOPSignOffDialog({
  open,
  onOpenChange,
  executionId,
  templateId,
  stepCompletionId,
  stepTitle,
  employeeName,
  photoUrl,
}: SOPSignOffDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const signOffMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', `/api/sops/templates/${templateId}/sign-off/${stepCompletionId}`, {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/sops/executions', executionId] });
      toast({ title: 'Signed off', description: `Step "${stepTitle}" has been approved.` });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to sign off on this step.', variant: 'destructive' });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            Manager Sign-Off Required
          </DialogTitle>
          <DialogDescription>
            {employeeName} completed a checkpoint step and needs your approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <p className="text-sm text-muted-foreground">Step</p>
            <p className="font-medium">{stepTitle}</p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">Completed by</p>
            <p className="font-medium">{employeeName}</p>
          </div>

          {photoUrl && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Photo Evidence</p>
              <img
                src={photoUrl}
                alt="Step evidence"
                className="rounded-lg border max-h-48 w-full object-cover"
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="flex-1 min-h-[44px]"
            onClick={() => onOpenChange(false)}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Close
          </Button>
          <Button
            className="flex-1 min-h-[44px] bg-green-600 hover:bg-green-700"
            onClick={() => signOffMutation.mutate()}
            disabled={signOffMutation.isPending}
          >
            {signOffMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
