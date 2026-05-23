import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const PROVIDERS = [
  "anthropic",
  "azure_openai",
  "gemini",
  "glm",
  "llamacpp",
  "ollama",
  "openai",
  "qwen",
];

const ROLES = ["chat", "descriptions", "embeddings"];

type AddGenAIDialogProps = {
  onClose: () => void;
  onCreated: () => void;
};

export function AddGenAIDialog({ onClose, onCreated }: AddGenAIDialogProps) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [roles, setRoles] = useState<string[]>(["descriptions"]);
  const [saving, setSaving] = useState(false);

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleCreate() {
    if (!name.trim() || !provider || !model.trim()) {
      toast.error("Name, provider, and model are required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { provider, model, roles };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      if (baseUrl.trim()) payload.base_url = baseUrl.trim();
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Add GenAI Agent</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <Row label="Name">
            <Input
              className="h-7 text-xs"
              placeholder="e.g. my_assistant"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Row>
          <Row label="Provider">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <Row label="Model">
            <Input
              className="h-7 text-xs"
              placeholder="e.g. claude-sonnet-4-6"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </Row>
          <Row label="API Key">
            <Input
              type="password"
              className="h-7 text-xs"
              placeholder="sk-… (optional)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Row>
          <Row label="Base URL">
            <Input
              className="h-7 text-xs"
              placeholder="https://… (optional)"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </Row>
          <div>
            <Label className="mb-2 block text-xs text-muted-foreground">
              Roles
            </Label>
            <div className="flex flex-col gap-2">
              {ROLES.map((role) => (
                <div key={role} className="flex items-center gap-2">
                  <Checkbox
                    id={`new-role-${role}`}
                    checked={roles.includes(role)}
                    onCheckedChange={() => toggleRole(role)}
                  />
                  <label
                    htmlFor={`new-role-${role}`}
                    className="cursor-pointer text-xs"
                  >
                    {role}
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
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
