import { useCallback, useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import axios from "axios";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import Heading from "@/components/ui/heading";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FrigateConfig } from "@/types/frigateConfig";
import { LuWifi, LuWifiOff, LuShieldCheck } from "react-icons/lu";
import { cn } from "@/lib/utils";

const AI_FEATURES = [
  "Generative AI providers (OpenAI, Anthropic, Gemini, Ollama, …)",
  "Remote semantic search embeddings",
  "Cloud-backed face recognition",
  "License plate recognition via remote model",
  "Object classification with remote models",
  "Audio transcription via cloud API",
  "Frigate+ cloud sync",
];

export default function LocalModeView() {
  useEffect(() => {
    document.title = "Local / Offline Mode — Argus";
  }, []);

  const { data: config } = useSWR<FrigateConfig>("config");
  const [saving, setSaving] = useState(false);

  const localMode = config?.local_mode ?? false;

  const toggle = useCallback(
    async (next: boolean) => {
      setSaving(true);
      try {
        const res = await axios.put("config/set", {
          config_data: { local_mode: next },
          requires_restart: 0,
        });
        if (res.data?.success) {
          await mutate("config");
          toast.success(
            next
              ? "Local / Offline Mode enabled — all cloud AI is now blocked."
              : "Local / Offline Mode disabled — cloud AI providers are active.",
            { position: "top-center" },
          );
        } else {
          toast.error(res.data?.message ?? "Failed to save setting", {
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
        setSaving(false);
      }
    },
    [],
  );

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-y-auto p-4 md:p-6">
      <Toaster position="top-center" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Heading as="h3" className="flex items-center gap-2">
            {localMode ? (
              <LuWifiOff className="size-5 text-amber-500" />
            ) : (
              <LuWifi className="size-5 text-muted-foreground" />
            )}
            Local / Offline Mode
          </Heading>
          <p className="max-w-2xl text-sm text-muted-foreground">
            When enabled, Argus will never contact external AI services.
            All AI provider clients are silenced in the backend. Settings
            for cloud AI features are locked in the UI as a reminder.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <Switch
            id="local-mode-toggle"
            checked={localMode}
            disabled={saving || !config}
            onCheckedChange={toggle}
          />
          <Label
            htmlFor="local-mode-toggle"
            className={cn(
              "cursor-pointer text-xs font-semibold",
              localMode ? "text-amber-500" : "text-muted-foreground",
            )}
          >
            {localMode ? "ON" : "OFF"}
          </Label>
        </div>
      </div>

      {localMode && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <LuShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Local / Offline Mode is <strong>active</strong>. Argus will not
            make any outbound AI API calls. Cloud AI settings are greyed out
            in the sidebar.
          </p>
        </div>
      )}

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-medium">Features disabled in Local Mode</h4>
        <ul className="space-y-2">
          {AI_FEATURES.map((feat) => (
            <li key={feat} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "size-1.5 rounded-full shrink-0",
                  localMode ? "bg-amber-500" : "bg-muted-foreground/40",
                )}
              />
              <span
                className={cn(
                  localMode
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {feat}
              </span>
              {localMode && (
                <Badge
                  variant="outline"
                  className="ml-auto border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-500"
                >
                  blocked
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Separator />

      <div className="space-y-1">
        <h4 className="text-sm font-medium">What still works</h4>
        <p className="text-sm text-muted-foreground">
          All local detection (CPU, Coral, TensorRT, OpenVINO, RKNN, Hailo),
          local semantic search (on-device embeddings), recording, motion
          detection, live streams, event history, MQTT, and all UI features
          continue to work normally.
        </p>
      </div>
    </div>
  );
}
