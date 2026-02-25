import { useState, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function QuickCaptureButton() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const captureMutation = useMutation({
    mutationFn: async (rawInput: string) => {
      return await apiRequest("POST", "/api/gtd/inbox", {
        raw_input: rawInput,
        source: "quick_capture",
      });
    },
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/inbox"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gtd/dashboard"] });
      toast({ title: "Captured! ✓", duration: 1500 });
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    },
    onError: () => {
      toast({ title: "Failed to capture", variant: "destructive" });
    },
  });

  const handleCapture = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    captureMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCapture();
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-36 right-4 z-50 w-12 h-12 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
        size="icon"
        aria-label="Quick capture"
      >
        <Plus className="h-6 w-6" />
      </Button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[50vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-lg">Quick Capture</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What's on your mind?"
              className="min-h-[80px] text-base resize-none"
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Press Enter to capture, Shift+Enter for new line
            </p>
          </div>
          <DrawerFooter className="pt-2 flex-row gap-2">
            <Button
              onClick={handleCapture}
              disabled={!input.trim() || captureMutation.isPending}
              className="flex-1"
            >
              {captureMutation.isPending ? "Capturing..." : "Capture"}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
