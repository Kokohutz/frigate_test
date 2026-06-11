import { useCallback, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import useSWR from "swr";
import axios from "axios";
import { toast } from "sonner";

export type AlertRulesNodeData = {
  label: string;
};

type AlertRule = {
  id?: string;
  name: string;
  event_type: "detection" | "review" | "recording";
  condition_json: string;
  enabled: boolean;
};

type AlertRulesDialogProps = {
  onClose: () => void;
};

const EMPTY_RULE: AlertRule = {
  name: "",
  event_type: "detection",
  condition_json: "{}",
  enabled: true,
};

function AlertRulesDialog({ onClose }: AlertRulesDialogProps) {
  const { data: rules, mutate } = useSWR<AlertRule[]>("config/alert_rules");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AlertRule>({ ...EMPTY_RULE });
  const [saving, setSaving] = useState(false);

  const handleAdd = useCallback(async () => {
    setSaving(true);
    try {
      await axios.post("config/alert_rules", form);
      await mutate();
      setForm({ ...EMPTY_RULE });
      setShowForm(false);
      toast.success("Alert rule added", { position: "top-center" });
    } catch (err: unknown) {
      const errMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Unknown error";
      toast.error(`Failed to add rule: ${errMsg}`, { position: "top-center" });
    } finally {
      setSaving(false);
    }
  }, [form, mutate]);

  const handleToggle = useCallback(
    async (rule: AlertRule) => {
      if (!rule.id) return;
      try {
        await axios.put(`config/alert_rules/${rule.id}`, {
          ...rule,
          enabled: !rule.enabled,
        });
        await mutate();
      } catch {
        toast.error("Failed to update rule", { position: "top-center" });
      }
    },
    [mutate],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await axios.delete(`config/alert_rules/${id}`);
        await mutate();
        toast.success("Rule deleted", { position: "top-center" });
      } catch {
        toast.error("Failed to delete rule", { position: "top-center" });
      }
    },
    [mutate],
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="scrollbar-container max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="size-4 text-amber-500" />
            Alert Rules
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Rules list */}
          {rules && rules.length > 0 ? (
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id ?? rule.name}
                  className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{rule.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge className="bg-amber-500/20 px-1 py-0 text-[10px] text-amber-400 hover:bg-amber-500/20">
                        {rule.event_type}
                      </Badge>
                      {!rule.enabled && (
                        <Badge
                          variant="outline"
                          className="px-1 py-0 text-[10px] text-muted-foreground"
                        >
                          disabled
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={() => handleToggle(rule)}
                    className="shrink-0"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => rule.id && handleDelete(rule.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            !showForm && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No alert rules defined.
              </p>
            )
          )}

          {/* Inline add form */}
          {showForm ? (
            <div className="rounded-lg border-2 border-amber-500/30 bg-amber-500/[0.03] p-4 space-y-3">
              <p className="text-sm font-semibold">New Rule</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  className="h-9 text-xs"
                  placeholder="e.g. Person at night"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Event Type</Label>
                <Select
                  value={form.event_type}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      event_type: v as AlertRule["event_type"],
                    }))
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="detection" className="text-xs">
                      detection
                    </SelectItem>
                    <SelectItem value="review" className="text-xs">
                      review
                    </SelectItem>
                    <SelectItem value="recording" className="text-xs">
                      recording
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Condition (JSON)</Label>
                <Textarea
                  className="min-h-[80px] font-mono text-xs"
                  placeholder='{"label": "person", "min_score": 0.8}'
                  value={form.condition_json}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, condition_json: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                />
                <Label className="text-xs">Enabled</Label>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="select"
                  className="flex-1"
                  onClick={handleAdd}
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? "Adding…" : "Add Rule"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full gap-2 text-xs"
              onClick={() => setShowForm(true)}
            >
              <Plus className="size-3.5" />
              Add rule
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AlertRulesNode({ data, selected }: NodeProps) {
  const d = data as AlertRulesNodeData;
  const [showDialog, setShowDialog] = useState(false);
  const { data: rules } = useSWR<AlertRule[]>("config/alert_rules");

  const enabledCount = rules?.filter((r) => r.enabled).length ?? 0;
  const totalCount = rules?.length ?? 0;

  return (
    <>
      <div
        className={cn(
          "min-w-[160px] cursor-pointer rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
          selected
            ? "border-amber-500 shadow-md shadow-amber-500/20"
            : "border-amber-500/40",
        )}
        onClick={() => setShowDialog(true)}
      >
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "#f59e0b" }}
        />

        <div className="flex items-center gap-2">
          <Bell className="size-3.5 shrink-0 text-amber-500" />
          <span className="truncate text-xs font-semibold">{d.label}</span>
          {totalCount > 0 && (
            <Badge
              className={cn(
                "ml-auto shrink-0 px-1.5 py-0 text-[10px]",
                enabledCount > 0
                  ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                  : "bg-muted text-muted-foreground hover:bg-muted",
              )}
            >
              {enabledCount}/{totalCount}
            </Badge>
          )}
        </div>

        {totalCount === 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Click to configure
          </p>
        )}
      </div>

      {showDialog && (
        <AlertRulesDialog onClose={() => setShowDialog(false)} />
      )}
    </>
  );
}
