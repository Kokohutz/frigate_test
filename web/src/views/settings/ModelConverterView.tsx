import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import axios from "axios";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import Heading from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FrigateConfig } from "@/types/frigateConfig";
import { LuUpload, LuDownload, LuFile, LuCpu } from "react-icons/lu";
import { cn } from "@/lib/utils";

type TargetFormat =
  | "onnx"
  | "tflite"
  | "tflite_edgetpu"
  | "tensorrt"
  | "openvino"
  | "rknn"
  | "hailo";

type SourceFormat =
  | "pytorch"
  | "onnx"
  | "tf_saved"
  | "keras_h5"
  | "tflite"
  | "tensorrt"
  | "unknown";

type ConversionJob = {
  job_id: string;
  source_filename: string;
  source_format: SourceFormat;
  target_format: TargetFormat;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  message: string;
  output_path: string | null;
  log_lines: string[];
};

type TargetsResponse = {
  targets: TargetFormat[];
  sources: SourceFormat[];
  detector_suggestions: Record<string, TargetFormat>;
};

const TARGET_LABELS: Record<TargetFormat, string> = {
  onnx: "ONNX (CPU / generic / ZMQ)",
  tflite: "TFLite",
  tflite_edgetpu: "TFLite + EdgeTPU compile",
  tensorrt: "TensorRT engine (NVIDIA)",
  openvino: "OpenVINO IR (Intel)",
  rknn: "RKNN (Rockchip)",
  hailo: "Hailo HEF",
};

const TARGET_NOTES: Partial<Record<TargetFormat, string>> = {
  tflite_edgetpu: "Requires edgetpu_compiler installed in the container.",
  tensorrt: "Requires the NVIDIA-tensorrt image variant (trtexec).",
  openvino: "Requires the OpenVINO image variant (mo).",
  rknn: "Requires the proprietary rknn-toolkit2 SDK.",
  hailo: "Requires the proprietary Hailo Dataflow Compiler.",
};

export default function ModelConverterView() {
  useEffect(() => {
    document.title = "Model Converter — Argus";
  }, []);

  const { data: config } = useSWR<FrigateConfig>("config");
  const { data: targetsInfo } = useSWR<TargetsResponse>("models/targets");

  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<TargetFormat | "">("");
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-suggest target from the first configured detector.
  useEffect(() => {
    if (target || !targetsInfo) return;
    const firstSuggestion = Object.values(targetsInfo.detector_suggestions)[0];
    if (firstSuggestion) setTarget(firstSuggestion);
  }, [targetsInfo, target]);

  // Poll job status.
  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "error") {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await axios.get(`models/jobs/${activeJob.job_id}`);
        if (res.data?.job) {
          setActiveJob(res.data.job);
        }
      } catch (e) {
        // job may have been GC'd; stop polling
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 1000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeJob]);

  const onPickFile = useCallback((f: File | null) => {
    setFile(f);
    setActiveJob(null);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onPickFile(f);
  }, [onPickFile]);

  const onSubmit = useCallback(async () => {
    if (!file || !target) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target", target);
      const res = await axios.post("models/convert", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success) {
        setActiveJob(res.data.job);
        toast.success("Conversion started", { position: "top-center" });
      } else {
        toast.error(res.data?.message ?? "Failed to start conversion", {
          position: "top-center",
        });
      }
    } catch (e: unknown) {
      const msg =
        axios.isAxiosError(e) && e.response?.data?.message
          ? e.response.data.message
          : String(e);
      toast.error(msg, { position: "top-center" });
    } finally {
      setSubmitting(false);
    }
  }, [file, target]);

  const downloadUrl = activeJob && activeJob.status === "done"
    ? `${axios.defaults.baseURL ?? ""}models/jobs/${activeJob.job_id}/download`
    : null;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <Toaster position="top-center" />
      <Heading as="h3">Model converter</Heading>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Upload an ML model file in any common format and Argus will convert it
        to the format your active detector expects. The intermediate ONNX file
        and the final converted model are written to{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          /config/model_cache/converted/
        </code>
        .
      </p>

      {/* Detector summary */}
      {config && targetsInfo && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <LuCpu className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Active detectors</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(
              (config.detectors ?? {}) as Record<string, { type: string }>,
            ).map(([name, det]) => (
              <Badge key={name} variant="outline" className="gap-1 font-mono">
                <span>{name}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-primary">{det.type}</span>
                <span className="text-muted-foreground">→</span>
                <span>{targetsInfo.detector_suggestions[name] ?? "onnx"}</span>
              </Badge>
            ))}
            {Object.keys(config.detectors ?? {}).length === 0 && (
              <span className="text-xs text-muted-foreground">
                No detectors configured.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Upload + target picker */}
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card p-4 transition-colors hover:border-primary/60",
            file && "border-primary/60",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pt,.pth,.onnx,.tflite,.h5,.pb,.engine,.plan"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <>
              <LuFile className="size-8 text-primary" />
              <span className="font-mono text-sm">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onPickFile(null);
                }}
              >
                Choose a different file
              </Button>
            </>
          ) : (
            <>
              <LuUpload className="size-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                Click or drop a model file here
              </span>
              <span className="text-xs text-muted-foreground">
                .pt · .pth · .onnx · .tflite · .h5 · .pb · .engine
              </span>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <Label className="text-sm font-medium">Target format</Label>
          <Select
            value={target}
            onValueChange={(v) => setTarget(v as TargetFormat)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a target…" />
            </SelectTrigger>
            <SelectContent>
              {targetsInfo?.targets.map((t) => (
                <SelectItem key={t} value={t}>
                  {TARGET_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target && TARGET_NOTES[target as TargetFormat] && (
            <p className="text-xs text-muted-foreground">
              {TARGET_NOTES[target as TargetFormat]}
            </p>
          )}
          <Button
            disabled={!file || !target || submitting || activeJob?.status === "running"}
            onClick={onSubmit}
          >
            {submitting ? "Submitting…" : "Convert"}
          </Button>
        </div>
      </div>

      {/* Job progress */}
      {activeJob && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "font-mono",
                  activeJob.status === "done" && "border-emerald-500/40 text-emerald-500",
                  activeJob.status === "error" && "border-red-500/40 text-red-500",
                  activeJob.status === "running" && "border-amber-500/40 text-amber-500",
                )}
              >
                {activeJob.status}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {activeJob.source_format} → {activeJob.target_format}
              </span>
            </div>
            {downloadUrl && (
              <a href={downloadUrl} download>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <LuDownload className="size-3.5" />
                  Download
                </Button>
              </a>
            )}
          </div>
          <Progress value={activeJob.progress * 100} className="h-2" />
          {activeJob.message && (
            <p className="mt-2 text-xs text-muted-foreground">
              {activeJob.message}
            </p>
          )}
          {activeJob.log_lines.length > 0 && (
            <>
              <Separator className="my-3" />
              <div className="max-h-64 overflow-y-auto rounded bg-muted/40 p-2 font-mono text-[11px] leading-snug">
                {activeJob.log_lines.slice(-50).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </>
          )}
          {activeJob.output_path && activeJob.status === "done" && (
            <p className="mt-2 break-all text-xs text-muted-foreground">
              Output saved to{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {activeJob.output_path}
              </code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
