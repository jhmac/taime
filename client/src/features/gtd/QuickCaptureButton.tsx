import { useState, useRef, useEffect } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter,
} from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function QuickCaptureButton() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-let-us-know", handler);
    return () => window.removeEventListener("open-let-us-know", handler);
  }, []);

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
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="max-h-[50vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-lg">Let us Know</DrawerTitle>
        </DrawerHeader>
        <div className="px-6 pb-2">
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
        <DrawerFooter className="pt-2 px-6 flex-row gap-2">
          <Button
            onClick={handleCapture}
            disabled={!input.trim() || captureMutation.isPending}
            className="flex-1"
          >
            {captureMutation.isPending ? "Submitting..." : "Submit"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
