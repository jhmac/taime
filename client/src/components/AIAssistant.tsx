import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import {
  Bot, X, Send, Loader2, Sparkles, Clock, MapPin,
  BookOpen, MessageSquare, ChevronLeft, Trash2, Plus,
  Navigation, AlertTriangle, CheckCircle, Car
} from 'lucide-react';

type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

type Conversation = {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  createdAt: string | null;
};

const QUICK_ACTIONS = [
  { label: "What should I do right now?", icon: Clock },
  { label: "Show my shift briefing", icon: Sparkles },
  { label: "How do I open the store?", icon: BookOpen },
  { label: "How do I process a return?", icon: BookOpen },
  { label: "What's the cleaning schedule?", icon: BookOpen },
  { label: "Show my commute info", icon: Car },
];

export default function AIAssistant() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'chat' | 'history' | 'briefing' | 'commute'>('chat');
  const [message, setMessage] = useState('');
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: conversations = [], isError: conversationsError } = useQuery<Conversation[]>({
    queryKey: ['/api/ai-assistant/conversations'],
    enabled: isOpen && view === 'history',
    retry: 1,
  });

  const { data: conversationMessages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['/api/ai-assistant/conversations', currentConvId, 'messages'],
    enabled: !!currentConvId,
  });

  const { data: commuteData, isError: commuteError } = useQuery<any>({
    queryKey: ['/api/ai-assistant/commute'],
    enabled: isOpen && view === 'commute',
    refetchInterval: isOpen && view === 'commute' ? 60000 : false,
    retry: 1,
  });

  useEffect(() => {
    if (currentConvId) {
      setLocalMessages(conversationMessages);
    }
  }, [conversationMessages, currentConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  useEffect(() => {
    if (isOpen && view === 'chat') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, view]);

  const chatConvIdRef = useRef<string | null>(null);

  const chatMutation = useMutation({
    mutationFn: async (msg: string) => {
      chatConvIdRef.current = currentConvId;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await apiRequest('POST', '/api/ai-assistant/chat', {
          message: msg,
          conversationId: currentConvId,
        }, { signal: controller.signal });
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: (data) => {
      if (currentConvId !== chatConvIdRef.current && chatConvIdRef.current !== null) return;
      if (!currentConvId) {
        setCurrentConvId(data.conversationId);
      }
      setLocalMessages(prev => [...prev, {
        role: 'assistant',
        content: data.message,
      }]);
      queryClient.invalidateQueries({ queryKey: ['/api/ai-assistant/conversations'] });
    },
    onError: (err: any) => {
      const isTimeout = err?.name === 'AbortError';
      const errorMsg = isTimeout
        ? "The request took too long. Please try again."
        : "Sorry, I'm having trouble right now. Please try again in a moment.";
      setLocalMessages(prev => [...prev, {
        role: 'assistant' as const,
        content: errorMsg,
      }]);
    },
  });

  const briefingMutation = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await apiRequest('POST', '/api/ai-assistant/briefing', {}, { signal: controller.signal });
        return res.json();
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onError: () => {
      toast({ title: "Briefing Failed", description: "Could not generate your briefing. Please try again.", variant: "destructive" });
    },
  });

  const deleteConvMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/ai-assistant/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-assistant/conversations'] });
      if (currentConvId) {
        setCurrentConvId(null);
        setLocalMessages([]);
      }
    },
  });

  const isBriefingIntent = (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    const briefingPatterns = [
      /^(show|get|give)\b.*\bbriefing\b/,
      /^(my\s+)?shift\s+briefing/,
      /^briefing$/,
      /\bbrief\s+me\b/,
    ];
    return briefingPatterns.some(p => p.test(lower));
  };

  const isCommuteIntent = (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    const commutePatterns = [
      /^(show|get)\b.*\bcommute\b/,
      /^commute\b/,
      /\bcommute\s+(info|intelligence|data|time|estimate)/,
      /^(how|what)\b.*(commute|drive\s+time|traffic)/,
    ];
    return commutePatterns.some(p => p.test(lower));
  };

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || chatMutation.isPending) return;

    if (isBriefingIntent(trimmed)) {
      setView('briefing');
      briefingMutation.mutate();
      setMessage('');
      return;
    }

    if (isCommuteIntent(trimmed)) {
      setView('commute');
      setMessage('');
      return;
    }

    setLocalMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setMessage('');
    chatMutation.mutate(trimmed);
  };

  const handleQuickAction = (action: string) => {
    if (isBriefingIntent(action)) {
      setView('briefing');
      briefingMutation.mutate();
      return;
    }
    if (isCommuteIntent(action)) {
      setView('commute');
      return;
    }
    setLocalMessages(prev => [...prev, { role: 'user', content: action }]);
    chatMutation.mutate(action);
  };

  const startNewChat = () => {
    setCurrentConvId(null);
    setLocalMessages([]);
    setView('chat');
  };

  const openConversation = (conv: Conversation) => {
    setCurrentConvId(conv.id);
    setView('chat');
  };

  if (!user) return null;

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 right-4 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-6rem)] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              {view !== 'chat' && view !== 'history' && (
                <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary/80 h-7 w-7 p-0" onClick={() => setView('chat')}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <Bot className="w-5 h-5" />
              <div>
                <span className="font-semibold text-sm">Taime Assistant</span>
                <span className="text-xs opacity-80 ml-2">AI Success Coach</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary/80 h-7 w-7 p-0" onClick={() => setView('history')}>
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary/80 h-7 w-7 p-0" onClick={startNewChat}>
                <Plus className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary/80 h-7 w-7 p-0" onClick={() => setIsOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {view === 'chat' && (
              <div className="flex flex-col h-full">
                <ScrollArea className="flex-1 p-4">
                  {localMessages.length === 0 ? (
                    <div className="space-y-4">
                      <div className="text-center py-4">
                        <Bot className="w-12 h-12 mx-auto text-primary opacity-50 mb-2" />
                        <h3 className="font-semibold text-sm">Hi{user.firstName ? `, ${user.firstName}` : ''}!</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          I'm your AI Success Coach. Ask me anything about store procedures, your schedule, or how to do something.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick actions</p>
                        {QUICK_ACTIONS.map((action) => (
                          <button
                            key={action.label}
                            onClick={() => handleQuickAction(action.label)}
                            className="w-full flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm hover:bg-muted transition-colors"
                          >
                            <action.icon className="w-4 h-4 text-primary shrink-0" />
                            <span>{action.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {localMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}>
                            <div className="whitespace-pre-wrap">{msg.content}</div>
                          </div>
                        </div>
                      ))}
                      {chatMutation.isPending && (
                        <div className="flex justify-start">
                          <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm text-muted-foreground">Thinking...</span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </ScrollArea>

                <div className="border-t p-3">
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                    className="flex gap-2"
                  >
                    <Input
                      ref={inputRef}
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      placeholder="Ask about procedures, tasks..."
                      className="text-sm"
                      disabled={chatMutation.isPending}
                    />
                    <Button type="submit" size="sm" disabled={!message.trim() || chatMutation.isPending}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </div>
              </div>
            )}

            {view === 'history' && (
              <ScrollArea className="h-full p-4">
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={startNewChat}
                  >
                    <Plus className="w-4 h-4" />
                    New conversation
                  </Button>
                  {conversationsError ? (
                    <div className="text-center py-4">
                      <AlertTriangle className="w-6 h-6 mx-auto text-destructive mb-2" />
                      <p className="text-sm text-muted-foreground">Couldn't load conversations.</p>
                      <button onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/ai-assistant/conversations'] })} className="text-xs text-primary underline mt-1">
                        Try again
                      </button>
                    </div>
                  ) : conversations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No previous conversations yet.
                    </p>
                  ) : (
                    conversations.map(conv => (
                      <div key={conv.id} className="flex items-center gap-2">
                        <button
                          onClick={() => openConversation(conv)}
                          className="flex-1 text-left p-3 rounded-lg border hover:bg-muted transition-colors"
                        >
                          <div className="text-sm font-medium truncate">{conv.title || 'Untitled'}</div>
                          {conv.lastMessageAt && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {new Date(conv.lastMessageAt).toLocaleDateString()}
                            </div>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => deleteConvMutation.mutate(conv.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}

            {view === 'briefing' && (
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold">Pre-Shift Briefing</h3>
                  </div>
                  {briefingMutation.isPending ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      <span className="ml-2 text-sm text-muted-foreground">Generating your briefing...</span>
                    </div>
                  ) : briefingMutation.data ? (
                    <Card>
                      <CardContent className="p-4">
                        <div className="whitespace-pre-wrap text-sm">{briefingMutation.data.briefing}</div>
                        {briefingMutation.data.commuteInfo && (
                          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground border-t pt-3">
                            <Car className="w-4 h-4" />
                            {briefingMutation.data.commuteInfo}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Click below to generate your shift briefing.
                    </p>
                  )}
                  {!briefingMutation.isPending && (
                    <Button variant="outline" size="sm" onClick={() => briefingMutation.mutate()}>
                      <Sparkles className="w-4 h-4 mr-1" />
                      {briefingMutation.data ? 'Refresh Briefing' : 'Generate Briefing'}
                    </Button>
                  )}
                </div>
              </ScrollArea>
            )}

            {view === 'commute' && (
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Navigation className="w-5 h-5 text-primary" />
                    <h3 className="font-semibold">Commute Intelligence</h3>
                  </div>
                  {commuteError ? (
                    <Card>
                      <CardContent className="p-4 text-center">
                        <AlertTriangle className="w-8 h-8 mx-auto text-destructive mb-2" />
                        <p className="text-sm font-medium">Couldn't Load Commute Info</p>
                        <p className="text-xs text-muted-foreground mt-1">Please try again later.</p>
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/ai-assistant/commute'] })}>
                          Retry
                        </Button>
                      </CardContent>
                    </Card>
                  ) : !commuteData ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : !commuteData.hasHomeLocation ? (
                    <Card>
                      <CardContent className="p-4 text-center">
                        <MapPin className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm font-medium">Set Your Home Location</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Save your home location in your profile settings to get commute estimates and departure alerts before your shifts.
                        </p>
                        <HomeLocationSetter />
                      </CardContent>
                    </Card>
                  ) : commuteData.noShift ? (
                    <Card>
                      <CardContent className="p-4 text-center">
                        <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                        <p className="text-sm">No shifts scheduled today. Enjoy your day off!</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">{commuteData.locationName}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="text-center p-3 rounded-lg bg-muted">
                            <div className="text-2xl font-bold">{commuteData.distance} mi</div>
                            <div className="text-xs text-muted-foreground">Distance</div>
                          </div>
                          <div className="text-center p-3 rounded-lg bg-muted">
                            <div className="text-2xl font-bold">~{commuteData.estimatedMinutes} min</div>
                            <div className="text-xs text-muted-foreground">Estimated drive</div>
                          </div>
                        </div>
                        <div className={`p-3 rounded-lg border-2 ${
                          commuteData.urgency === 'late' ? 'border-red-500 bg-red-50 dark:bg-red-950' :
                          commuteData.urgency === 'now' ? 'border-orange-500 bg-orange-50 dark:bg-orange-950' :
                          commuteData.urgency === 'soon' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950' :
                          'border-green-500 bg-green-50 dark:bg-green-950'
                        }`}>
                          <div className="flex items-center gap-2">
                            {commuteData.urgency === 'late' ? (
                              <AlertTriangle className="w-5 h-5 text-red-500" />
                            ) : commuteData.urgency === 'now' ? (
                              <AlertTriangle className="w-5 h-5 text-orange-500" />
                            ) : (
                              <Clock className="w-5 h-5 text-green-500" />
                            )}
                            <div>
                              <div className="text-sm font-semibold">
                                {commuteData.urgency === 'late' ? "You should have left already!" :
                                 commuteData.urgency === 'now' ? "Leave now!" :
                                 commuteData.urgency === 'soon' ? `Leave in ${commuteData.minutesUntilLeave} minutes` :
                                 `Leave by ${new Date(commuteData.leaveBy).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Shift starts at {new Date(commuteData.shiftStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function HomeLocationSetter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async (coords: { latitude: number; longitude: number }) => {
      return apiRequest('PUT', '/api/ai-assistant/home-location', coords);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-assistant/commute'] });
      toast({ title: "Home Location Saved", description: "You'll now get commute alerts before your shifts." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save location.", variant: "destructive" });
    },
  });

  const handleSetLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "Not Supported", description: "Your browser doesn't support location services.", variant: "destructive" });
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        saveMutation.mutate({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLoading(false);
      },
      (err) => {
        const msg = err.code === err.TIMEOUT
          ? "Location request timed out. Please try again."
          : "Please allow location access to use this feature.";
        toast({ title: "Location Error", description: msg, variant: "destructive" });
        setLoading(false);
      },
      { timeout: 15000, enableHighAccuracy: false }
    );
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-3"
      onClick={handleSetLocation}
      disabled={loading || saveMutation.isPending}
    >
      {loading || saveMutation.isPending ? (
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
      ) : (
        <MapPin className="w-4 h-4 mr-1" />
      )}
      Use my current location
    </Button>
  );
}
