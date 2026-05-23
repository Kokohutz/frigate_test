import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  MdInfoOutline,
  MdSpeed,
  MdSettings,
  MdStorage,
  MdSmartToy,
  MdMemory,
  MdHub,
} from "react-icons/md";
import type { PipelineNode } from "../PipelineFlow";

const DETECTOR_TYPES = [
  "cpu_tfl",
  "edgetpu",
  "hailo8l",
  "onnx",
  "openvino",
  "synaptics",
  "tensorrt",
];

const MODEL_TYPES = ["ssd", "yolov8", "yolov9", "yolonas", "yologeneric"];

const GENAI_PROVIDERS = [
  "anthropic",
  "azure_openai",
  "gemini",
  "glm",
  "llamacpp",
  "ollama",
  "openai",
  "qwen",
  "zai",
];

const GENAI_ROLES = ["chat", "descriptions", "embeddings"];

const RETAIN_MODES = ["all", "motion", "active_objects"];

const MODEL_INPUT_SIZES = [256, 300, 320, 416, 480, 640];

type NodeEditSheetProps = {
  node: PipelineNode | null;
  onClose: () => void;
  onDelete?: (nodeId: string) => void;
  onUpdate: (nodeId: string, newData: Record<string, unknown>) => void;
};

export function NodeEditSheet({
  node,
  onClose,
  onDelete,
  onUpdate,
}: NodeEditSheetProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (node) setDraft({ ...(node.data as Record<string, unknown>) });
  }, [node]);

  const set = useCallback(
    (key: string, value: unknown) =>
      setDraft((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const handleSave = useCallback(async () => {
    if (!node) return;
    setSaving(true);
    try {
      const { type, configKey } = node.data as {
        type: string;
        configKey: string;
      };

      if (type === "camera") {
        const paths: [string, unknown][] = [
          [`cameras.${configKey}.detect.enabled`, draft.detectEnabled],
          [`cameras.${configKey}.detect.fps`, draft.fps],
          [`cameras.${configKey}.detect.width`, draft.detectWidth],
          [`cameras.${configKey}.detect.height`, draft.detectHeight],
          [`cameras.${configKey}.record.enabled`, draft.recordEnabled],
          [`cameras.${configKey}.record.retain.days`, draft.cameraRetainDays],
          [`cameras.${configKey}.record.retain.mode`, draft.cameraRetainMode],
          [`cameras.${configKey}.objects.genai.enabled`, draft.genaiEnabled],
          [`cameras.${configKey}.motion.threshold`, draft.motionThreshold],
          [`cameras.${configKey}.motion.contour_area`, draft.motionContourArea],
        ];
        await Promise.all(
          paths.map(([path, value]) =>
            value === undefined
              ? null
              : axios.put("config/set", { path, value }),
          ),
        );
      } else if (type === "detector") {
        await axios.put("config/set", {
          path: `detectors.${configKey}.type`,
          value: draft.detectorType,
        });
        if (draft.device !== undefined) {
          await axios.put("config/set", {
            path: `detectors.${configKey}.device`,
            value: draft.device,
          });
        }
        if (draft.modelType) {
          await axios.put("config/set", {
            path: `detectors.${configKey}.model.model_type`,
            value: draft.modelType,
          });
        }
        if (draft.modelWidth) {
          await axios.put("config/set", {
            path: `detectors.${configKey}.model.width`,
            value: draft.modelWidth,
          });
        }
        if (draft.modelHeight) {
          await axios.put("config/set", {
            path: `detectors.${configKey}.model.height`,
            value: draft.modelHeight,
          });
        }
      } else if (type === "genai") {
        const payload: Record<string, unknown> = {
          provider: draft.provider,
          model: draft.model,
          roles: draft.roles,
        };
        if (draft.apiKey) payload.api_key = draft.apiKey;
        if (draft.baseUrl) payload.base_url = draft.baseUrl;
        const providerOpts: Record<string, unknown> = {};
        if (draft.temperature !== undefined)
          providerOpts.temperature = draft.temperature;
        if (draft.maxTokens) providerOpts.max_tokens = draft.maxTokens;
        if (Object.keys(providerOpts).length > 0)
          payload.provider_options = providerOpts;
        await axios.put("config/set", {
          path: `genai.${configKey}`,
          value: payload,
        });
      } else if (type === "mqtt") {
        await axios.put("config/set", {
          path: "mqtt.host",
          value: draft.host,
        });
        await axios.put("config/set", {
          path: "mqtt.port",
          value: Number(draft.port) || 1883,
        });
        await axios.put("config/set", {
          path: "mqtt.enabled",
          value: draft.enabled,
        });
        if (draft.topicPrefix !== undefined)
          await axios.put("config/set", {
            path: "mqtt.topic_prefix",
            value: draft.topicPrefix,
          });
        if (draft.statsInterval !== undefined)
          await axios.put("config/set", {
            path: "mqtt.stats_interval",
            value: draft.statsInterval,
          });
        if (draft.tlsInsecure !== undefined)
          await axios.put("config/set", {
            path: "mqtt.tls_insecure",
            value: draft.tlsInsecure,
          });
      } else if (type === "storage") {
        await axios.put("config/set", {
          path: "record.retain.days",
          value: Number(draft.retainDays) || 7,
        });
        if (draft.retainMode)
          await axios.put("config/set", {
            path: "record.retain.mode",
            value: draft.retainMode,
          });
        if (draft.expireInterval !== undefined)
          await axios.put("config/set", {
            path: "record.expire_interval",
            value: draft.expireInterval,
          });
      }

      onUpdate(node.id, draft);
      toast.success("Saved — restart Frigate to apply.");
    } catch {
      toast.error("Failed to save config.");
    } finally {
      setSaving(false);
    }
  }, [node, draft, onUpdate]);

  const handleDelete = useCallback(async () => {
    if (!node) return;
    const { type, configKey, label } = node.data as {
      type: string;
      configKey: string;
      label: string;
    };
    if (!confirm(`Delete ${type} "${label}"?`)) return;

    try {
      if (type === "genai") {
        await axios.put("config/set", {
          path: `genai.${configKey}`,
          value: null,
        });
      } else if (type === "detector" && configKey !== "coral") {
        await axios.put("config/set", {
          path: `detectors.${configKey}`,
          value: null,
        });
      } else {
        toast.info("This node cannot be deleted from the UI.");
        return;
      }
      onDelete?.(node.id);
      onClose();
      toast.success(`Deleted ${type} "${label}".`);
    } catch {
      toast.error("Failed to delete.");
    }
  }, [node, onDelete, onClose]);

  if (!node) return null;
  const { type, configKey, label } = node.data as {
    type: string;
    configKey: string;
    label: string;
  };

  return (
    <Sheet open={!!node} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[420px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px]"
      >
        <SheetHeader className="space-y-1 px-5 py-4">
          <div className="flex items-center gap-2">
            <NodeIcon type={type} />
            <SheetTitle className="text-sm">Edit {label || type}</SheetTitle>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Config key:{" "}
            <code className="rounded bg-muted px-1 py-0.5">{configKey}</code>
          </p>
        </SheetHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {type === "camera" && <CameraFields draft={draft} set={set} />}
          {type === "detector" && <DetectorFields draft={draft} set={set} />}
          {type === "genai" && <GenAIFields draft={draft} set={set} />}
          {type === "mqtt" && <MqttFields draft={draft} set={set} />}
          {type === "storage" && <StorageFields draft={draft} set={set} />}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2 px-5 py-3">
          {(type === "genai" || type === "detector") && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={saving}
            >
              Delete
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NodeIcon({ type }: { type: string }) {
  const cls = "size-4";
  switch (type) {
    case "camera":
      return <MdSpeed className={cn(cls, "text-blue-500")} />;
    case "detector":
      return <MdMemory className={cn(cls, "text-purple-500")} />;
    case "genai":
      return <MdSmartToy className={cn(cls, "text-green-500")} />;
    case "storage":
      return <MdStorage className={cn(cls, "text-orange-500")} />;
    case "mqtt":
      return <MdHub className={cn(cls, "text-yellow-500")} />;
    default:
      return <MdSettings className={cls} />;
  }
}

// ── Field groups ──────────────────────────────────────────────────────────────

type FieldProps = {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
};

function CameraFields({ draft, set }: FieldProps) {
  const fps = (draft.fps as number) ?? 5;
  const w = (draft.detectWidth as number) ?? 1280;
  const h = (draft.detectHeight as number) ?? 720;
  const retainDays = (draft.cameraRetainDays as number) ?? 7;
  const motionThreshold = (draft.motionThreshold as number) ?? 30;
  const motionContour = (draft.motionContourArea as number) ?? 10;

  return (
    <div className="space-y-5">
      <Section title="Detection" icon={<MdSpeed className="size-3.5" />}>
        <Row label="Enabled">
          <Switch
            checked={!!draft.detectEnabled}
            onCheckedChange={(v) => set("detectEnabled", v)}
          />
        </Row>
        <SliderRow
          label="Detect FPS"
          value={fps}
          min={1}
          max={30}
          step={1}
          onChange={(v) => set("fps", v)}
          unit="fps"
          hint="Lower = less CPU. 5 fps is recommended."
        />
        <Row label="Width" hint="Detection input width (px)">
          <Input
            type="number"
            className="h-7 w-24 text-right text-xs"
            value={String(w)}
            onChange={(e) => set("detectWidth", Number(e.target.value))}
          />
        </Row>
        <Row label="Height" hint="Detection input height (px)">
          <Input
            type="number"
            className="h-7 w-24 text-right text-xs"
            value={String(h)}
            onChange={(e) => set("detectHeight", Number(e.target.value))}
          />
        </Row>
      </Section>

      <Section title="Recording" icon={<MdStorage className="size-3.5" />}>
        <Row label="Enabled">
          <Switch
            checked={!!draft.recordEnabled}
            onCheckedChange={(v) => set("recordEnabled", v)}
          />
        </Row>
        <SliderRow
          label="Retain days"
          value={retainDays}
          min={1}
          max={90}
          step={1}
          onChange={(v) => set("cameraRetainDays", v)}
          unit="days"
        />
        <Row label="Retain mode">
          <Select
            value={String(draft.cameraRetainMode ?? "motion")}
            onValueChange={(v) => set("cameraRetainMode", v)}
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETAIN_MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section title="GenAI" icon={<MdSmartToy className="size-3.5" />}>
        <Row label="Enabled" hint="Generate object descriptions">
          <Switch
            checked={!!draft.genaiEnabled}
            onCheckedChange={(v) => set("genaiEnabled", v)}
          />
        </Row>
      </Section>

      <Section title="Motion" icon={<MdSettings className="size-3.5" />}>
        <SliderRow
          label="Threshold"
          value={motionThreshold}
          min={1}
          max={100}
          step={1}
          onChange={(v) => set("motionThreshold", v)}
          hint="Sensitivity. Lower = more sensitive to motion."
        />
        <SliderRow
          label="Contour area"
          value={motionContour}
          min={1}
          max={50}
          step={1}
          onChange={(v) => set("motionContourArea", v)}
          hint="Minimum motion area to count."
        />
      </Section>
    </div>
  );
}

function DetectorFields({ draft, set }: FieldProps) {
  const modelW = (draft.modelWidth as number) ?? 320;
  const modelH = (draft.modelHeight as number) ?? 320;

  return (
    <div className="space-y-5">
      <Section title="Backend" icon={<MdMemory className="size-3.5" />}>
        <Row label="Type">
          <Select
            value={String(draft.detectorType ?? "")}
            onValueChange={(v) => set("detectorType", v)}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DETECTOR_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Device" hint="e.g. 0, usb, /dev/apex_0">
          <Input
            className="h-7 w-40 text-xs"
            placeholder="auto"
            value={String(draft.device ?? "")}
            onChange={(e) => set("device", e.target.value)}
          />
        </Row>
      </Section>

      <Section title="Model" icon={<MdSettings className="size-3.5" />}>
        <Row label="Model type">
          <Select
            value={String(draft.modelType ?? "ssd")}
            onValueChange={(v) => set("modelType", v)}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Input width">
          <SegmentedNumber
            value={modelW}
            options={MODEL_INPUT_SIZES}
            onChange={(v) => set("modelWidth", v)}
          />
        </Row>
        <Row label="Input height">
          <SegmentedNumber
            value={modelH}
            options={MODEL_INPUT_SIZES}
            onChange={(v) => set("modelHeight", v)}
          />
        </Row>
      </Section>
    </div>
  );
}

function GenAIFields({ draft, set }: FieldProps) {
  const roles = (draft.roles as string[]) ?? [];
  const temperature = (draft.temperature as number) ?? 0.7;
  const maxTokens = (draft.maxTokens as number) ?? 1024;

  function toggleRole(role: string) {
    set(
      "roles",
      roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role],
    );
  }

  return (
    <div className="space-y-5">
      <Section title="Provider" icon={<MdSmartToy className="size-3.5" />}>
        <Row label="Provider">
          <Select
            value={String(draft.provider ?? "")}
            onValueChange={(v) => set("provider", v)}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {GENAI_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Model">
          <Input
            className="h-7 w-40 text-xs"
            placeholder="claude-sonnet-4-6"
            value={String(draft.model ?? "")}
            onChange={(e) => set("model", e.target.value)}
          />
        </Row>
      </Section>

      <Section title="Credentials" icon={<MdSettings className="size-3.5" />}>
        <Row label="API key">
          <Input
            type="password"
            className="h-7 w-44 text-xs"
            placeholder="sk-…"
            value={String(draft.apiKey ?? "")}
            onChange={(e) => set("apiKey", e.target.value)}
          />
        </Row>
        <Row label="Base URL" hint="Override the default endpoint">
          <Input
            className="h-7 w-44 text-xs"
            placeholder="https://… (optional)"
            value={String(draft.baseUrl ?? "")}
            onChange={(e) => set("baseUrl", e.target.value)}
          />
        </Row>
      </Section>

      <Section title="Generation" icon={<MdSpeed className="size-3.5" />}>
        <SliderRow
          label="Temperature"
          value={temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => set("temperature", v)}
          hint="0 = deterministic, 2 = creative."
        />
        <SliderRow
          label="Max tokens"
          value={maxTokens}
          min={64}
          max={4096}
          step={64}
          onChange={(v) => set("maxTokens", v)}
        />
      </Section>

      <Section title="Roles" icon={<MdInfoOutline className="size-3.5" />}>
        <div className="flex flex-col gap-2 pt-1">
          {GENAI_ROLES.map((role) => (
            <label
              key={role}
              htmlFor={`role-${role}`}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-border hover:bg-muted/50"
            >
              <Checkbox
                id={`role-${role}`}
                checked={roles.includes(role)}
                onCheckedChange={() => toggleRole(role)}
              />
              <span className="font-medium">{role}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {role === "chat" && "interactive Q&A"}
                {role === "descriptions" && "object summaries"}
                {role === "embeddings" && "semantic search"}
              </span>
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}

function MqttFields({ draft, set }: FieldProps) {
  const statsInterval = (draft.statsInterval as number) ?? 60;

  return (
    <div className="space-y-5">
      <Section title="Connection" icon={<MdHub className="size-3.5" />}>
        <Row label="Enabled">
          <Switch
            checked={!!draft.enabled}
            onCheckedChange={(v) => set("enabled", v)}
          />
        </Row>
        <Row label="Host">
          <Input
            className="h-7 w-44 text-xs"
            placeholder="192.168.1.x"
            value={String(draft.host ?? "")}
            onChange={(e) => set("host", e.target.value)}
          />
        </Row>
        <Row label="Port">
          <Input
            type="number"
            className="h-7 w-24 text-right text-xs"
            value={String(draft.port ?? 1883)}
            onChange={(e) => set("port", Number(e.target.value))}
          />
        </Row>
      </Section>

      <Section title="Topics" icon={<MdSettings className="size-3.5" />}>
        <Row label="Topic prefix">
          <Input
            className="h-7 w-44 text-xs"
            placeholder="frigate"
            value={String(draft.topicPrefix ?? "frigate")}
            onChange={(e) => set("topicPrefix", e.target.value)}
          />
        </Row>
        <SliderRow
          label="Stats interval"
          value={statsInterval}
          min={10}
          max={300}
          step={10}
          onChange={(v) => set("statsInterval", v)}
          unit="s"
        />
      </Section>

      <Section title="Security" icon={<MdInfoOutline className="size-3.5" />}>
        <Row label="TLS insecure" hint="Skip cert verification">
          <Switch
            checked={!!draft.tlsInsecure}
            onCheckedChange={(v) => set("tlsInsecure", v)}
          />
        </Row>
      </Section>
    </div>
  );
}

function StorageFields({ draft, set }: FieldProps) {
  const retainDays = (draft.retainDays as number) ?? 7;
  const expireInterval = (draft.expireInterval as number) ?? 60;

  return (
    <div className="space-y-5">
      <Section title="Retention" icon={<MdStorage className="size-3.5" />}>
        <SliderRow
          label="Retain days"
          value={retainDays}
          min={1}
          max={365}
          step={1}
          onChange={(v) => set("retainDays", v)}
          unit="days"
          hint="Recordings older than this are deleted."
        />
        <Row label="Retain mode">
          <Select
            value={String(draft.retainMode ?? "motion")}
            onValueChange={(v) => set("retainMode", v)}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETAIN_MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section title="Maintenance" icon={<MdSettings className="size-3.5" />}>
        <SliderRow
          label="Expire interval"
          value={expireInterval}
          min={30}
          max={600}
          step={30}
          onChange={(v) => set("expireInterval", v)}
          unit="s"
          hint="How often to run cleanup."
        />
      </Section>
    </div>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/30 px-3 py-2.5">
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-1 flex-col gap-0.5">
        <Label className="text-xs font-medium">{label}</Label>
        {hint && (
          <span className="text-[10px] leading-tight text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <Label className="text-xs font-medium">{label}</Label>
          {hint && (
            <span className="text-[10px] leading-tight text-muted-foreground">
              {hint}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="py-1"
      />
    </div>
  );
}

function SegmentedNumber({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md border border-border bg-card p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "rounded px-2 py-1 font-mono text-[10px] transition-colors",
            value === opt
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
