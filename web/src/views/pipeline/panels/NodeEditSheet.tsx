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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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

const GENAI_PROVIDERS = [
  "anthropic",
  "azure_openai",
  "gemini",
  "glm",
  "llamacpp",
  "ollama",
  "openai",
  "qwen",
];

const GENAI_ROLES = ["chat", "descriptions", "embeddings"];

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
          [`cameras.${configKey}.record.enabled`, draft.recordEnabled],
          [`cameras.${configKey}.detect.fps`, draft.fps],
          [`cameras.${configKey}.objects.genai.enabled`, draft.genaiEnabled],
        ];
        await Promise.all(
          paths.map(([path, value]) =>
            axios.put("config/set", { path, value }),
          ),
        );
      } else if (type === "detector") {
        await axios.put("config/set", {
          path: `detectors.${configKey}.type`,
          value: draft.detectorType,
        });
        if (draft.device) {
          await axios.put("config/set", {
            path: `detectors.${configKey}.device`,
            value: draft.device,
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
      } else if (type === "storage") {
        await axios.put("config/set", {
          path: "record.retain.days",
          value: Number(draft.retainDays) || 7,
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
  const { type } = node.data as { type: string };

  return (
    <Sheet open={!!node} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[380px] flex-col gap-0 overflow-y-auto p-0"
      >
        <SheetHeader className="px-5 py-4">
          <SheetTitle className="text-sm">
            Edit{" "}
            {(node.data as { label: string }).label ||
              (node.data as { type: string }).type}
          </SheetTitle>
        </SheetHeader>

        <Separator />

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {type === "camera" && <CameraFields draft={draft} set={set} />}
          {type === "detector" && <DetectorFields draft={draft} set={set} />}
          {type === "genai" && <GenAIFields draft={draft} set={set} />}
          {type === "mqtt" && <MqttFields draft={draft} set={set} />}
          {type === "storage" && <StorageFields draft={draft} set={set} />}
        </div>

        <Separator />

        <div className="flex items-center justify-between px-5 py-3">
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
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Field groups ──────────────────────────────────────────────────────────────

type FieldProps = {
  draft: Record<string, unknown>;
  set: (k: string, v: unknown) => void;
};

function CameraFields({ draft, set }: FieldProps) {
  return (
    <>
      <Field label="Detect enabled">
        <Switch
          checked={!!draft.detectEnabled}
          onCheckedChange={(v) => set("detectEnabled", v)}
        />
      </Field>
      <Field label="Detect FPS">
        <Input
          type="number"
          className="h-7 text-xs"
          value={String(draft.fps ?? "")}
          onChange={(e) => set("fps", Number(e.target.value))}
        />
      </Field>
      <Field label="Record enabled">
        <Switch
          checked={!!draft.recordEnabled}
          onCheckedChange={(v) => set("recordEnabled", v)}
        />
      </Field>
      <Field label="GenAI enabled">
        <Switch
          checked={!!draft.genaiEnabled}
          onCheckedChange={(v) => set("genaiEnabled", v)}
        />
      </Field>
    </>
  );
}

function DetectorFields({ draft, set }: FieldProps) {
  return (
    <>
      <Field label="Type">
        <Select
          value={String(draft.detectorType ?? "")}
          onValueChange={(v) => set("detectorType", v)}
        >
          <SelectTrigger className="h-7 text-xs">
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
      </Field>
      <Field label="Device">
        <Input
          className="h-7 text-xs"
          placeholder="e.g. 0 or /dev/apex_0"
          value={String(draft.device ?? "")}
          onChange={(e) => set("device", e.target.value)}
        />
      </Field>
    </>
  );
}

function GenAIFields({ draft, set }: FieldProps) {
  const roles = (draft.roles as string[]) ?? [];

  function toggleRole(role: string) {
    set(
      "roles",
      roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role],
    );
  }

  return (
    <>
      <Field label="Provider">
        <Select
          value={String(draft.provider ?? "")}
          onValueChange={(v) => set("provider", v)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {GENAI_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Model">
        <Input
          className="h-7 text-xs"
          placeholder="e.g. claude-sonnet-4-6"
          value={String(draft.model ?? "")}
          onChange={(e) => set("model", e.target.value)}
        />
      </Field>
      <Field label="API Key">
        <Input
          type="password"
          className="h-7 text-xs"
          placeholder="sk-..."
          value={String(draft.apiKey ?? "")}
          onChange={(e) => set("apiKey", e.target.value)}
        />
      </Field>
      <Field label="Base URL">
        <Input
          className="h-7 text-xs"
          placeholder="https://... (optional)"
          value={String(draft.baseUrl ?? "")}
          onChange={(e) => set("baseUrl", e.target.value)}
        />
      </Field>
      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">
          Roles
        </Label>
        <div className="flex flex-col gap-2">
          {GENAI_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-2">
              <Checkbox
                id={`role-${role}`}
                checked={roles.includes(role)}
                onCheckedChange={() => toggleRole(role)}
              />
              <label
                htmlFor={`role-${role}`}
                className="cursor-pointer text-xs"
              >
                {role}
              </label>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function MqttFields({ draft, set }: FieldProps) {
  return (
    <>
      <Field label="Enabled">
        <Switch
          checked={!!draft.enabled}
          onCheckedChange={(v) => set("enabled", v)}
        />
      </Field>
      <Field label="Host">
        <Input
          className="h-7 text-xs"
          placeholder="192.168.1.x"
          value={String(draft.host ?? "")}
          onChange={(e) => set("host", e.target.value)}
        />
      </Field>
      <Field label="Port">
        <Input
          type="number"
          className="h-7 text-xs"
          value={String(draft.port ?? 1883)}
          onChange={(e) => set("port", e.target.value)}
        />
      </Field>
    </>
  );
}

function StorageFields({ draft, set }: FieldProps) {
  return (
    <Field label="Retain days">
      <Input
        type="number"
        className="h-7 text-xs"
        value={String(draft.retainDays ?? 7)}
        onChange={(e) => set("retainDays", e.target.value)}
      />
    </Field>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="shrink-0 text-xs text-muted-foreground">{label}</Label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
