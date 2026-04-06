import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Mic, Square, Pause, Play, ArrowLeft, Users, Check, Loader2, ChevronDown,
} from "lucide-react";

interface TeamMember {
  id: string;
  name: string;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type RecordingState = "idle" | "recording" | "paused" | "stopped";
type PageState = "setup" | "recording" | "uploading" | "processing";

export default function MeetingsNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [participantSearch, setParticipantSearch] = useState("");
  const [showParticipants, setShowParticipants] = useState(false);
  const [pageState, setPageState] = useState<PageState>("setup");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioSupported, setAudioSupported] = useState(true);
  const [meetingId, setMeetingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const { data: teamData } = useQuery<{ success: boolean; data: TeamMember[] }>({
    queryKey: ["/api/team/members"],
  });
  const teamMembers = teamData?.data || [];
  const filtered = teamMembers.filter(m =>
    m.name.toLowerCase().includes(participantSearch.toLowerCase()) &&
    !selectedParticipants.includes(m.id)
  );

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const createMeetingMutation = useMutation({
    mutationFn: async (payload: { title: string; participantIds: string[]; date: string }) => {
      const res = await apiRequest("POST", "/api/meetings", payload);
      if (!res.ok) throw new Error("Failed to create meeting");
      return res.json();
    },
    onSuccess: (data) => {
      const id = data.data.id;
      setMeetingId(id);
      setPageState("recording");
      startRecording();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        blobRef.current = new Blob(chunksRef.current, { type: mimeType });
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      recorder.start(1000);
      setRecordingState("recording");
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    } catch {
      setAudioSupported(false);
      toast({
        title: "Microphone not available",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setRecordingState("paused");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setRecordingState("recording");
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecordingState("stopped");
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const uploadAndProcess = async () => {
    if (!blobRef.current || !meetingId) return;
    setPageState("uploading");

    try {
      const formData = new FormData();
      const ext = blobRef.current.type.includes("mp4") ? "mp4" : "webm";
      formData.append("audio", blobRef.current, `meeting.${ext}`);
      formData.append("durationSeconds", String(elapsed));

      const res = await fetch(`/api/meetings/${meetingId}/audio`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) throw new Error("Upload failed");

      queryClient.invalidateQueries({ queryKey: ["/api/meetings"] });
      setPageState("processing");
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setPageState("recording");
    }
  };

  const handleStartMeeting = () => {
    if (!title.trim()) {
      toast({ title: "Title required", description: "Please enter a meeting title.", variant: "destructive" });
      return;
    }
    createMeetingMutation.mutate({ title: title.trim(), participantIds: selectedParticipants, date: new Date().toISOString() });
  };

  const toggleParticipant = (id: string) => {
    setSelectedParticipants(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  if (pageState === "processing" && meetingId) {
    return <ProcessingView meetingId={meetingId} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/meetings")}
            className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-muted-foreground" />
          </button>
          <h1 className="text-xl font-bold text-foreground">
            {pageState === "setup" ? "New Meeting" : "Recording"}
          </h1>
        </div>

        {pageState === "setup" && (
          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium block mb-1.5">Meeting Title</label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g., Weekly Team Standup"
                maxLength={200}
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm font-medium block mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4" /> Participants (optional)
                </span>
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowParticipants(!showParticipants)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-md border border-input bg-background text-sm hover:bg-muted/30 transition-colors"
                >
                  <span className="text-muted-foreground">
                    {selectedParticipants.length > 0
                      ? `${selectedParticipants.length} participant${selectedParticipants.length !== 1 ? "s" : ""} selected`
                      : "Add participants..."}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>

                {showParticipants && (
                  <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-popover border border-border rounded-md shadow-md">
                    <div className="p-2 border-b border-border">
                      <Input
                        value={participantSearch}
                        onChange={e => setParticipantSearch(e.target.value)}
                        placeholder="Search team members..."
                        className="h-8 text-sm"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {filtered.length === 0 && (
                        <div className="px-3 py-3 text-sm text-muted-foreground text-center">No members found</div>
                      )}
                      {filtered.map(member => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleParticipant(member.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/40 text-sm text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-xs flex-shrink-0">
                            {member.name[0]?.toUpperCase() || "?"}
                          </div>
                          <span className="flex-1">{member.name}</span>
                        </button>
                      ))}
                    </div>
                    {selectedParticipants.length > 0 && (
                      <div className="p-2 border-t border-border">
                        <button
                          onClick={() => setShowParticipants(false)}
                          className="w-full text-xs text-center text-primary hover:underline"
                        >
                          Done ({selectedParticipants.length} selected)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedParticipants.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedParticipants.map(id => {
                    const m = teamMembers.find(t => t.id === id);
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="gap-1 cursor-pointer"
                        onClick={() => toggleParticipant(id)}
                      >
                        {m?.name || "Unknown"} ×
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            <Button
              onClick={handleStartMeeting}
              disabled={!title.trim() || createMeetingMutation.isPending}
              className="w-full gap-2"
              size="lg"
            >
              {createMeetingMutation.isPending ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> Starting...</>
              ) : (
                <><Mic className="h-5 w-5" /> Start Recording</>
              )}
            </Button>
          </div>
        )}

        {pageState === "recording" && (
          <div className="flex flex-col items-center space-y-8 pt-8">
            <div className="text-center">
              <div className="text-5xl font-mono font-bold text-foreground tabular-nums mb-2">
                {formatElapsed(elapsed)}
              </div>
              <p className="text-sm text-muted-foreground">
                {recordingState === "recording" && (
                  <span className="flex items-center justify-center gap-1.5">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    Recording
                  </span>
                )}
                {recordingState === "paused" && "Paused"}
                {recordingState === "stopped" && "Recording complete"}
              </p>
            </div>

            {recordingState !== "stopped" && (
              <div className="w-32 h-32 rounded-full border-4 border-primary/20 flex items-center justify-center relative">
                {recordingState === "recording" && (
                  <div className="absolute inset-0 rounded-full bg-red-500/10 animate-ping" />
                )}
                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${recordingState === "recording" ? "bg-red-500" : "bg-muted"}`}>
                  <Mic className={`h-8 w-8 ${recordingState === "recording" ? "text-white" : "text-muted-foreground"}`} />
                </div>
              </div>
            )}

            {recordingState === "stopped" && (
              <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="h-12 w-12 text-green-600 dark:text-green-400" />
              </div>
            )}

            <div className="flex gap-3 w-full max-w-xs">
              {recordingState === "recording" && (
                <>
                  <Button variant="outline" onClick={pauseRecording} className="flex-1 gap-2">
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                  <Button variant="destructive" onClick={stopRecording} className="flex-1 gap-2">
                    <Square className="h-4 w-4" /> Stop
                  </Button>
                </>
              )}
              {recordingState === "paused" && (
                <>
                  <Button variant="outline" onClick={resumeRecording} className="flex-1 gap-2">
                    <Play className="h-4 w-4" /> Resume
                  </Button>
                  <Button variant="destructive" onClick={stopRecording} className="flex-1 gap-2">
                    <Square className="h-4 w-4" /> Stop
                  </Button>
                </>
              )}
              {recordingState === "stopped" && (
                <Button onClick={uploadAndProcess} className="flex-1 gap-2" size="lg">
                  <Check className="h-5 w-5" /> Process Meeting
                </Button>
              )}
            </div>

            {recordingState !== "stopped" && (
              <p className="text-xs text-muted-foreground text-center">
                Recording: <span className="font-medium">{title}</span>
              </p>
            )}
          </div>
        )}

        {pageState === "uploading" && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <p className="font-medium text-foreground">Uploading audio...</p>
            <p className="text-sm text-muted-foreground">Please wait while we upload your recording.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProcessingView({ meetingId }: { meetingId: string }) {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);

  const { data } = useQuery<{ success: boolean; data: any }>({
    queryKey: ["/api/meetings", meetingId],
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      return status === "ready" || status === "failed" ? false : 3000;
    },
  });

  const status = data?.data?.status;

  useEffect(() => {
    const steps = [0, 1, 2];
    let i = 0;
    const iv = setInterval(() => {
      if (i < steps.length - 1) {
        i++;
        setStep(i);
      }
    }, 2500);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (status === "ready") {
      setTimeout(() => navigate(`/meetings/${meetingId}`), 1000);
    }
  }, [status, meetingId, navigate]);

  const steps = [
    { label: "Transcribing audio", icon: "🎙️" },
    { label: "Summarizing content", icon: "📝" },
    { label: "Finding action items", icon: "✅" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground mb-1">Processing your meeting</h2>
          <p className="text-sm text-muted-foreground">AI is analyzing your recording. This usually takes under a minute.</p>
        </div>

        <div className="space-y-3 text-left">
          {steps.map((s, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${i <= step ? "bg-primary/5" : "opacity-40"}`}>
              <span className="text-xl">{s.icon}</span>
              <span className={`text-sm font-medium ${i < step ? "text-muted-foreground line-through" : i === step ? "text-foreground" : "text-muted-foreground"}`}>
                {s.label}
              </span>
              {i < step && <Check className="h-4 w-4 text-green-500 ml-auto" />}
              {i === step && <Loader2 className="h-4 w-4 text-primary animate-spin ml-auto" />}
            </div>
          ))}
        </div>

        {status === "failed" && (
          <div className="bg-destructive/10 rounded-lg p-4">
            <p className="text-sm text-destructive font-medium">Processing failed. Please try again.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate("/meetings")}>
              Back to Meetings
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
