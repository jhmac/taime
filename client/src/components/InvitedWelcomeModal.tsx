import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PartyPopper, CheckCircle, Users, Clock, Sparkles } from "lucide-react";

interface InvitedWelcomeModalProps {
  userName: string;
  storeName: string;
  roleName?: string;
  onDismiss: () => void;
}

export default function InvitedWelcomeModal({
  userName,
  storeName,
  roleName,
  onDismiss,
}: InvitedWelcomeModalProps) {
  const [open, setOpen] = useState(true);

  const handleClose = () => {
    setOpen(false);
    onDismiss();
  };

  const firstName = userName?.split(" ")[0] || "there";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent
        className="sm:max-w-sm border-0 shadow-2xl p-0 overflow-hidden bg-white"
        onInteractOutside={e => e.preventDefault()}
      >
        {/* Header banner */}
        <div className="bg-gradient-to-br from-[#F47D31] to-[#e06b1f] px-6 py-8 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <PartyPopper className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-extrabold text-white">
            Welcome, {firstName}!
          </h2>
          <p className="text-orange-100 text-sm mt-1">
            You've joined the <strong className="text-white">{storeName}</strong> team
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-5">
          {roleName && (
            <div className="flex items-center gap-3 bg-orange-50 rounded-xl px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-[#F47D31]/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-[#F47D31]" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Your role</p>
                <p className="text-sm font-semibold text-[#1A1A2E] capitalize">{roleName}</p>
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              What you can do
            </p>
            {[
              { icon: Clock, text: "Clock in & out from your phone" },
              { icon: Users, text: "View your schedule and teammates" },
              { icon: Sparkles, text: "Get AI-powered shift insights" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 text-sm text-[#1A1A2E]">
                <Icon className="w-4 h-4 text-[#F47D31] flex-shrink-0" />
                {text}
              </div>
            ))}
          </div>

          <Button
            className="w-full h-11 bg-[#F47D31] hover:bg-[#e06b1f] text-white font-semibold shadow-md shadow-orange-100"
            onClick={handleClose}
          >
            Let's go!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
