import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, invalidatePrefix } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, Loader2, ArrowLeft, ArrowRight, Search } from "lucide-react";

function getInitials(firstName?: string | null, lastName?: string | null) {
  return ((firstName?.charAt(0) || "") + (lastName?.charAt(0) || "")).toUpperCase() || "?";
}

const QUICK_MESSAGES = [
  "Great teamwork!",
  "You crushed it today!",
  "Thanks for covering!",
  "Amazing customer service!",
  "Love the improvement!",
  "You really went above and beyond!",
  "Your positive attitude is infectious!",
  "Thanks for always being reliable!",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GiveKudoDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [selectedRecipient, setSelectedRecipient] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

  const { data: teamData } = useQuery<any[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const team = useMemo(() => {
    const all = (teamData ?? []).filter((u: any) => u.id !== user?.id && u.isActive !== false);
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((u: any) =>
      u.firstName?.toLowerCase().includes(q) || u.lastName?.toLowerCase().includes(q)
    );
  }, [teamData, user, search]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/kudos", {
        toEmployeeId: selectedRecipient.id,
        message: message.trim(),
      });
    },
    onSuccess: () => {
      invalidatePrefix("/api/kudos");
      setShowConfetti(true);
      setTimeout(() => {
        setShowConfetti(false);
        handleClose();
        toast({
          title: "Kudo sent! 💛",
          description: `${selectedRecipient.firstName} will see it on the Kudos Wall.`,
        });
      }, 1800);
    },
    onError: () => {
      toast({ title: "Failed to send kudo", variant: "destructive" });
    },
  });

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep(1);
      setSelectedRecipient(null);
      setMessage("");
      setSearch("");
      setShowConfetti(false);
    }, 200);
  };

  const charsLeft = 280 - message.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        {showConfetti && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="text-center animate-in zoom-in-50 fade-in duration-500">
              <div className="text-6xl mb-3">💛</div>
              <h3 className="text-xl font-bold">Kudo Sent!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedRecipient?.firstName} will love this
              </p>
            </div>
          </div>
        )}

        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-pink-500" />
            Give a Kudo
            <span className="text-xs text-muted-foreground font-normal ml-auto">
              Step {step} of 3
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 mb-2">
          {[1, 2, 3].map(s => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-pink-400" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Who deserves recognition?</p>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search team members..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[240px] overflow-auto py-1">
              {team.map((u: any) => {
                const selected = selectedRecipient?.id === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedRecipient(u)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                      selected
                        ? "border-pink-400 bg-pink-50 dark:bg-pink-950/30 scale-105"
                        : "border-transparent hover:border-muted-foreground/20 hover:bg-muted/30"
                    }`}
                  >
                    <Avatar className="h-11 w-11">
                      <AvatarFallback className={`text-xs font-bold ${
                        selected ? "bg-pink-200 dark:bg-pink-800 text-pink-700 dark:text-pink-300" : "bg-primary/10 text-primary"
                      }`}>
                        {getInitials(u.firstName, u.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[10px] font-medium leading-tight text-center truncate w-full">
                      {u.firstName || u.email?.split("@")[0]}
                    </span>
                  </button>
                );
              })}
              {team.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground text-center py-6">No team members found</p>
              )}
            </div>
            <Button
              className="w-full rounded-xl"
              disabled={!selectedRecipient}
              onClick={() => setStep(2)}
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">What made them awesome?</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_MESSAGES.map(qm => (
                <button
                  key={qm}
                  type="button"
                  onClick={() => setMessage(qm)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                    message === qm
                      ? "border-pink-400 bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-300"
                      : "border-border hover:border-pink-300 hover:bg-pink-50/50 dark:hover:bg-pink-950/20"
                  }`}
                >
                  {qm}
                </button>
              ))}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Or write your own</p>
                <span className={`text-[10px] ${charsLeft < 20 ? "text-red-500" : "text-muted-foreground"}`}>
                  {charsLeft}
                </span>
              </div>
              <Textarea
                placeholder="What did they do that was awesome?"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 280))}
                className="min-h-[70px] text-sm resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                className="flex-1 rounded-xl"
                disabled={!message.trim()}
                onClick={() => setStep(3)}
              >
                Preview <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-pink-50 to-amber-50 dark:from-pink-950/30 dark:to-amber-950/20 rounded-2xl p-5 border border-pink-200/50 dark:border-pink-800/30">
              <div className="flex items-center gap-2 mb-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {getInitials(user?.firstName, user?.lastName)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm text-muted-foreground">You</span>
                <span className="text-pink-400 mx-1">→</span>
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-pink-200 dark:bg-pink-800 text-pink-700 dark:text-pink-300">
                    {getInitials(selectedRecipient?.firstName, selectedRecipient?.lastName)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{selectedRecipient?.firstName}</span>
              </div>
              <p className="text-sm leading-relaxed">"{message}"</p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setStep(2)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Edit
              </Button>
              <Button
                className="flex-1 rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 hover:from-pink-600 hover:to-amber-600 text-white"
                disabled={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                {sendMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Heart className="h-4 w-4 mr-1" />
                )}
                Send Kudo 💛
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
