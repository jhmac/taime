import { Clock, Sparkles, BookOpen, Car } from 'lucide-react';

export const QUICK_ACTIONS = [
  { label: "What should I do right now?", icon: Clock },
  { label: "Show my shift briefing", icon: Sparkles },
  { label: "How do I open the store?", icon: BookOpen },
  { label: "How do I process a return?", icon: BookOpen },
  { label: "What's the cleaning schedule?", icon: BookOpen },
  { label: "Show my commute info", icon: Car },
] as const;
