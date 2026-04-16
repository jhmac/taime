import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Video, Camera, Square, RotateCcw, Check, Upload } from "lucide-react";
import { Capacitor } from "@capacitor/core";

const MAX_DURATION = 60;
const IS_NATIVE = Capacitor.isNativePlatform();

const CATEGORIES = [
  { value: "process", label: "Process", icon: "fas fa-cogs", color: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" },
  { value: "workspace", label: "Workspace", icon: "fas fa-store", color: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" },
  { value: "customer_experience", label: "Customer", icon: "fas fa-smile", color: "bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400" },
  { value: "visual_merchandising", label: "Visual", icon: "fas fa-palette", color: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" },
  { value: "inventory", label: "Inventory", icon: "fas fa-boxes", color: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" },
  { value: "equipment", label: "Equipment", icon: "fas fa-tools", color: "bg-slate-100 dark:bg-slate-900/30 text-slate-600 dark:text-slate-400" },
  { value: "other", label: "Other", icon: "fas fa-lightbulb", color: "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function VideoRecordDialog({ open, onOpenChange, onSuccess }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<"camera" | "details" | "uploading" | "done">("camera");
  const [cameraSupported, setCameraSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);

  const [isNativeCapturing, setIsNativeCapturing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("process");
  const [uploadProgress, setUploadProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (IS_NATIVE) {
      setCameraSupported(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      setCameraSupported(false);
    }
  }, []);

  const captureNativeVideo = useCallback(async () => {
    setIsNativeCapturing(true);
    try {
      const { Camera } = await import("@capacitor/camera");
      const result = await Camera.recordVideo({ saveToGallery: false });
      const url = result.webPath ?? result.uri ?? "";
      if (!url) throw new Error("No video path returned");
      const response = await fetch(url);
      const blob = await response.blob();
      setRecordedBlob(blob);
      setPreviewUrl(url);
      generateThumbnail(url);
      setStep("details");
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (!msg.includes("cancel") && !msg.includes("dismiss")) {
        toast({ title: "Camera error", description: "Could not record video. Please try again.", variant: "destructive" });
      }
    } finally {
      setIsNativeCapturing(false);
    }
  }, [toast]);

  const pickNativeGalleryVideo = useCallback(async () => {
    setIsNativeCapturing(true);
    try {
      const { Camera } = await import("@capacitor/camera");
      const gallery = await Camera.chooseFromGallery({ limit: 1 });
      const media = gallery.results?.[0];
      if (!media) return;
      const url = media.webPath ?? media.uri ?? "";
      if (!url) throw new Error("No video path returned");
      const response = await fetch(url);
      const blob = await response.blob();
      setRecordedBlob(blob);
      setPreviewUrl(url);
      generateThumbnail(url);
      setStep("details");
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (!msg.includes("cancel") && !msg.includes("dismiss")) {
        toast({ title: "Gallery error", description: "Could not select video.", variant: "destructive" });
      }
    } finally {
      setIsNativeCapturing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open && step === "camera" && cameraSupported) {
      startCamera();
    }
    return () => {
      stopStream();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [open, step, cameraSupported, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      generateThumbnail(url);
      stopStream();
    };

    recorder.start(1000);
    setRecording(true);
    setElapsed(0);

    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        if (prev >= MAX_DURATION - 1) {
          recorder.stop();
          setRecording(false);
          if (timerRef.current) clearInterval(timerRef.current);
          return MAX_DURATION;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const resetRecording = () => {
    setRecordedBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setThumbnailDataUrl(null);
    setElapsed(0);
    startCamera();
  };

  const generateThumbnail = (videoUrl: string) => {
    const vid = document.createElement("video");
    vid.src = videoUrl;
    vid.crossOrigin = "anonymous";
    vid.preload = "metadata";
    vid.muted = true;
    vid.onloadedmetadata = () => {
      vid.currentTime = Math.min(0.5, vid.duration || 0.5);
    };
    vid.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = vid.videoWidth || 640;
      canvas.height = vid.videoHeight || 360;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        setThumbnailDataUrl(canvas.toDataURL("image/jpeg", 0.7));
      }
      vid.src = "";
      vid.load();
    };
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast({ title: "Invalid file", description: "Please select a video file", variant: "destructive" });
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 100MB", variant: "destructive" });
      return;
    }
    setRecordedBlob(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    generateThumbnail(url);
  };

  const handleUpload = async () => {
    if (!recordedBlob || !title.trim()) return;
    setStep("uploading");
    setUploadProgress(10);

    try {
      const formData = new FormData();
      const ext = recordedBlob.type.includes("mp4") ? ".mp4" : ".webm";
      formData.append("video", recordedBlob, `improvement${ext}`);
      formData.append("s3Key", `stores/default/videos/${Date.now()}/improvement${ext}`);

      setUploadProgress(30);

      const uploadRes = await fetch("/api/videos/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();
      setUploadProgress(70);

      const createRes = await apiRequest("POST", "/api/videos", {
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        storageType: "local",
        s3Key: uploadData.s3Key,
        durationSeconds: elapsed || undefined,
        thumbnailUrl: thumbnailDataUrl || undefined,
      });

      if (!createRes.ok) throw new Error("Failed to create video record");
      setUploadProgress(100);

      setStep("done");
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast({ title: "Upload error", description: message, variant: "destructive" });
      setStep("details");
    }
  };

  const handleClose = () => {
    stopStream();
    if (timerRef.current) clearInterval(timerRef.current);
    setStep("camera");
    setRecording(false);
    setRecordedBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setThumbnailDataUrl(null);
    setTitle("");
    setDescription("");
    setCategory("process");
    setElapsed(0);
    setUploadProgress(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg p-0 overflow-hidden max-h-[85vh] sm:max-h-[90vh] flex flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Video className="h-5 w-5 text-orange-500" />
            {step === "camera" && "Record Improvement"}
            {step === "details" && "Add Details"}
            {step === "uploading" && "Uploading..."}
            {step === "done" && "Success!"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {step === "camera" && (
            <div className="px-4 pb-4">
              {cameraSupported ? (
                <div className="relative">
                  {!recordedBlob ? (
                    <>
                      <video
                        ref={videoRef}
                        className="w-full aspect-video rounded-xl bg-black object-cover"
                        playsInline
                        muted
                      />
                      {recording && (
                        <div className="absolute top-3 left-3 bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                          <span className="w-2 h-2 bg-white rounded-full" />
                          {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / 1:00
                        </div>
                      )}
                      <div className="flex justify-center mt-4">
                        {!recording ? (
                          <button
                            onClick={startRecording}
                            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center shadow-lg ring-4 ring-red-200 dark:ring-red-900/50"
                          >
                            <div className="w-6 h-6 bg-white rounded-full" />
                          </button>
                        ) : (
                          <button
                            onClick={stopRecording}
                            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center shadow-lg ring-4 ring-red-200 dark:ring-red-900/50"
                          >
                            <Square className="h-6 w-6 text-white fill-white" />
                          </button>
                        )}
                      </div>
                      <p className="text-center text-xs text-muted-foreground mt-2">
                        {recording ? "Tap to stop" : "Tap to start recording (60s max)"}
                      </p>
                    </>
                  ) : (
                    <>
                      <video
                        ref={previewRef}
                        src={previewUrl || undefined}
                        className="w-full aspect-video rounded-xl bg-black object-cover"
                        controls
                        playsInline
                      />
                      <div className="flex gap-2 mt-4">
                        <Button variant="outline" onClick={resetRecording} className="flex-1">
                          <RotateCcw className="h-4 w-4 mr-1" /> Re-record
                        </Button>
                        <Button onClick={() => setStep("details")} className="flex-1 bg-gradient-to-r from-orange-500 to-pink-500 text-white">
                          <Check className="h-4 w-4 mr-1" /> Use This
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center py-8 bg-muted/30 rounded-xl border-2 border-dashed border-muted-foreground/20">
                    <Camera className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                    {IS_NATIVE ? (
                      <>
                        <p className="text-sm text-muted-foreground mb-4">
                          Record a video or pick one from your gallery.
                        </p>
                        <div className="flex flex-col gap-2">
                          <Button
                            onClick={captureNativeVideo}
                            disabled={isNativeCapturing}
                            className="bg-gradient-to-r from-orange-500 to-pink-500 text-white"
                          >
                            <Video className="h-4 w-4 mr-1.5" />
                            {isNativeCapturing ? "Opening camera…" : "Record Video"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={pickNativeGalleryVideo}
                            disabled={isNativeCapturing}
                          >
                            <Upload className="h-4 w-4 mr-1.5" />
                            Choose from Gallery
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground mb-3">
                          Camera not available. Upload a video file instead.
                        </p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm"
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                          <Upload className="h-4 w-4 mr-1" /> Choose Video File
                        </Button>
                      </>
                    )}
                  </div>
                  {recordedBlob && previewUrl && (
                    <>
                      <video
                        src={previewUrl}
                        className="w-full aspect-video rounded-xl bg-black object-cover"
                        controls
                        playsInline
                      />
                      <Button onClick={() => setStep("details")} className="w-full bg-gradient-to-r from-orange-500 to-pink-500 text-white">
                        <Check className="h-4 w-4 mr-1" /> Continue
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "details" && (
            <div className="px-4 pb-4 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">What did you improve?</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Reorganized the stockroom shelving"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Tell us about it (optional)</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What was the before and after?"
                  maxLength={1000}
                  rows={3}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Category</label>
                <div className="grid grid-cols-4 gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => setCategory(c.value)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-center ${
                        category === c.value
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:border-muted-foreground/20"
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${c.color}`}>
                        <i className={`${c.icon} text-sm`} />
                      </div>
                      <span className="text-[10px] font-medium leading-tight">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Button
                onClick={handleUpload}
                disabled={!title.trim()}
                className="w-full bg-gradient-to-r from-orange-500 to-pink-500 text-white"
              >
                <Upload className="h-4 w-4 mr-1" /> Share Improvement
              </Button>
            </div>
          )}

          {step === "uploading" && (
            <div className="px-4 pb-8 text-center">
              <div className="py-8">
                <Upload className="h-12 w-12 text-orange-500 mx-auto mb-4 animate-bounce" />
                <p className="text-sm font-medium mb-4">Uploading your improvement...</p>
                <Progress value={uploadProgress} className="h-2 max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground mt-2">{uploadProgress}%</p>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="px-4 pb-8 text-center">
              <div className="py-8">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                  <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-lg font-bold mb-1">Your improvement is live!</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Your team can now see and learn from your improvement.
                </p>
                <Button onClick={handleClose} className="rounded-full">
                  Done
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
