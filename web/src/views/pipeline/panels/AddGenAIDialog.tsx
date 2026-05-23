import { useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  SiAnthropic,
  SiOpenai,
  SiGooglegemini,
  SiOllama,
  SiAlibabacloud,
} from "react-icons/si";
import { MdAutoAwesome, MdCloud, MdComputer } from "react-icons/md";

type Provider = {
  id: string;
  label: string;
  icon: React.ReactNode;
  defaultModel: string;
  description: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
};

const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic Claude",
    icon: <SiAnthropic className="size-4 text-orange-400" />,
    defaultModel: "claude-sonnet-4-6",
    description: "Best image reasoning. 200K context.",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    icon: <SiOpenai className="size-4 text-emerald-400" />,
    defaultModel: "gpt-4o",
    description: "GPT-4o, GPT-4o-mini.",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    id: "azure_openai",
    label: "Azure OpenAI",
    icon: <MdCloud className="size-4 text-blue-400" />,
    defaultModel: "gpt-4o",
    description: "Same as OpenAI, on Azure.",
    needsApiKey: true,
    needsBaseUrl: true,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    icon: <SiGooglegemini className="size-4 text-yellow-400" />,
    defaultModel: "gemini-2.0-flash",
    description: "Fast and free tier available.",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    id: "glm",
    label: "Zhipu GLM",
    icon: <MdAutoAwesome className="size-4 text-cyan-400" />,
    defaultModel: "glm-4v-flash",
    description: "GLM-4V Chinese provider.",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    id: "zai",
    label: "Z.AI (GLM coding)",
    icon: <MdAutoAwesome className="size-4 text-sky-400" />,
    defaultModel: "glm-5",
    description: "GLM-5 / 4.6 via api.z.ai with thinking mode.",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    id: "qwen",
    label: "Alibaba Qwen",
    icon: <SiAlibabacloud className="size-4 text-purple-400" />,
    defaultModel: "qwen-vl-max",
    description: "Qwen-VL multimodal.",
    needsApiKey: true,
    needsBaseUrl: false,
  },
  {
    id: "ollama",
    label: "Ollama",
    icon: <SiOllama className="size-4 text-green-400" />,
    defaultModel: "llava:13b",
    description: "Local — no API key needed.",
    needsApiKey: false,
    needsBaseUrl: true,
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    icon: <MdComputer className="size-4 text-lime-400" />,
    defaultModel: "llava",
    description: "Self-hosted OpenAI-compatible.",
    needsApiKey: false,
    needsBaseUrl: true,
  },
];

const ROLES = [
  { id: "chat", label: "Chat", hint: "interactive Q&A" },
  { id: "descriptions", label: "Descriptions", hint: "object summaries" },
  { id: "embeddings", label: "Embeddings", hint: "semantic search" },
];

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function AddGenAIDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [roles, setRoles] = useState<string[]>(["descriptions"]);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [saving, setSaving] = useState(false);

  const provider = useMemo(
    () => PROVIDERS.find((p) => p.id === providerId),
    [providerId],
  );

  function selectProvider(p: Provider) {
    setProviderId(p.id);
    if (!model) setModel(p.defaultModel);
  }

  function toggleRole(id: string) {
    setRoles((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  }

  async function handleCreate() {
    if (!name.trim() || !providerId || !model.trim()) {
      toast.error("Name, provider, and model are required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider: providerId,
        model: model.trim(),
        roles,
      };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      if (baseUrl.trim()) payload.base_url = baseUrl.trim();
      const opts: Record<string, unknown> = {};
      if (temperature !== 0.7) opts.temperature = temperature;
      if (maxTokens !== 1024) opts.max_tokens = maxTokens;
      if (Object.keys(opts).length > 0) payload.provider_options = opts;
      await axios.put("config/set", {
        path: `genai.${name.trim()}`,
        value: payload,
      });
      toast.success(`GenAI agent "${name}" created.`);
      onCreated();
    } catch {
      toast.error("Failed to create GenAI agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="text-sm">Add GenAI Agent</DialogTitle>
          <DialogDescription className="text-xs">
            Configure an LLM provider for descriptions, chat, or embeddings.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-4">
          {/* Name */}
          <div>
            <Label className="mb-1.5 block text-xs font-medium">
              Agent name
            </Label>
            <Input
              className="h-8 text-xs"
              placeholder="my_assistant"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Provider grid */}
          <div>
            <Label className="mb-2 block text-xs font-medium">Provider</Label>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border-2 px-3 py-2 text-left transition-all",
                    providerId === p.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/50",
                  )}
                >
                  <div className="flex w-full items-center gap-1.5">
                    {p.icon}
                    <span className="text-xs font-semibold">{p.label}</span>
                  </div>
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    {p.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Model + creds */}
          {provider && (
            <>
              <div>
                <Label className="mb-1.5 block text-xs font-medium">
                  Model
                </Label>
                <Input
                  className="h-8 text-xs"
                  placeholder={provider.defaultModel}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
              {provider.needsApiKey && (
                <div>
                  <Label className="mb-1.5 block text-xs font-medium">
                    API key
                  </Label>
                  <Input
                    type="password"
                    className="h-8 text-xs"
                    placeholder="sk-…"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              )}
              {provider.needsBaseUrl && (
                <div>
                  <Label className="mb-1.5 block text-xs font-medium">
                    Base URL
                  </Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="http://localhost:11434"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {/* Generation sliders */}
          <div className="space-y-3 rounded-lg border border-border bg-card/30 p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Temperature</Label>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {temperature.toFixed(1)}
              </span>
            </div>
            <Slider
              value={[temperature]}
              min={0}
              max={2}
              step={0.1}
              onValueChange={(v) => setTemperature(v[0])}
            />
            <p className="text-[10px] text-muted-foreground">
              0 = deterministic · 2 = creative
            </p>

            <div className="flex items-center justify-between pt-2">
              <Label className="text-xs font-medium">Max tokens</Label>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {maxTokens}
              </span>
            </div>
            <Slider
              value={[maxTokens]}
              min={64}
              max={4096}
              step={64}
              onValueChange={(v) => setMaxTokens(v[0])}
            />
          </div>

          {/* Roles */}
          <div>
            <Label className="mb-2 block text-xs font-medium">Roles</Label>
            <div className="flex flex-col gap-1">
              {ROLES.map((r) => (
                <label
                  key={r.id}
                  htmlFor={`add-role-${r.id}`}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors",
                    roles.includes(r.id)
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <Checkbox
                    id={`add-role-${r.id}`}
                    checked={roles.includes(r.id)}
                    onCheckedChange={() => toggleRole(r.id)}
                  />
                  <span className="font-medium">{r.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {r.hint}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
