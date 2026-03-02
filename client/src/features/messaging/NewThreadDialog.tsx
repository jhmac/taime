import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, X, MessageSquare, Users, Loader2 } from "lucide-react";

function getInitials(firstName?: string | null, lastName?: string | null) {
  return ((firstName?.charAt(0) || "") + (lastName?.charAt(0) || "")).toUpperCase() || "?";
}

interface TeamMember {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role?: { name: string } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (threadId: string) => void;
}

export default function NewThreadDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TeamMember[]>([]);
  const [groupTitle, setGroupTitle] = useState("");

  const { data: teamData } = useQuery<{ id: string; firstName: string | null; lastName: string | null; email: string | null; roleId: number | null }[]>({
    queryKey: ["/api/messages/contacts"],
    enabled: open,
  });

  const teamMembers = useMemo(() => {
    if (!teamData) return [];
    return teamData;
  }, [teamData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return teamMembers;
    const q = search.toLowerCase();
    return teamMembers.filter(m =>
      (m.firstName?.toLowerCase().includes(q)) ||
      (m.lastName?.toLowerCase().includes(q)) ||
      (m.email?.toLowerCase().includes(q))
    );
  }, [teamMembers, search]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const isGroup = selected.length > 1;
      const res = await apiRequest("POST", "/api/messages/threads", {
        thread_type: isGroup ? "group" : "direct",
        title: isGroup && groupTitle.trim() ? groupTitle.trim() : undefined,
        participant_ids: selected.map(s => s.id),
      });
      return res.json();
    },
    onSuccess: (data) => {
      onCreated(data.data.id);
      setSelected([]);
      setSearch("");
      setGroupTitle("");
    },
    onError: () => {
      toast({ title: "Failed to create conversation", variant: "destructive" });
    },
  });

  const toggleSelect = (member: TeamMember) => {
    setSelected(prev =>
      prev.some(s => s.id === member.id)
        ? prev.filter(s => s.id !== member.id)
        : [...prev, member]
    );
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelected([]);
    setSearch("");
    setGroupTitle("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> New Message
          </DialogTitle>
        </DialogHeader>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map(s => (
              <Badge key={s.id} variant="secondary" className="gap-1 pr-1">
                {s.firstName} {s.lastName}
                <button onClick={() => toggleSelect(s)} className="ml-0.5 rounded-full hover:bg-muted">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {selected.length > 1 && (
          <Input
            placeholder="Group name (optional)"
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
          />
        )}

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search team members..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <ScrollArea className="h-[260px]">
          <div className="space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No team members found</p>
            ) : (
              filtered.map(member => {
                const isSelected = selected.some(s => s.id === member.id);
                return (
                  <button
                    key={member.id}
                    onClick={() => toggleSelect(member)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/50 transition-colors ${
                      isSelected ? "bg-primary/5 ring-1 ring-primary/20" : ""
                    }`}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {getInitials(member.firstName, member.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.firstName} {member.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate capitalize">
                        Team member
                      </p>
                    </div>
                    {isSelected && (
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <span className="text-primary-foreground text-xs">✓</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            disabled={selected.length === 0 || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : selected.length > 1 ? (
              <Users className="h-4 w-4 mr-1" />
            ) : (
              <MessageSquare className="h-4 w-4 mr-1" />
            )}
            {selected.length > 1 ? "Create Group" : "Start Chat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
