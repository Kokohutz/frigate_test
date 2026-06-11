import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import axios from "axios";
import { toast } from "sonner";
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
import ActivityIndicator from "@/components/indicators/activity-indicator";
import { Plus, Video } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

type FederatedInstance = {
  name: string;
  url: string;
  status: "online" | "offline" | "degraded" | string;
  cameras: number;
  events_today: number;
};

type AddInstanceForm = {
  name: string;
  url: string;
  token: string;
};

const EMPTY_FORM: AddInstanceForm = { name: "", url: "", token: "" };

function StatusDot({ status }: { status: string }) {
  const color =
    status === "online"
      ? "bg-green-500"
      : status === "degraded"
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full",
        color,
      )}
      title={status}
    />
  );
}

type AddInstanceDialogProps = {
  onClose: () => void;
  onAdded: () => void;
};

function AddInstanceDialog({ onClose, onAdded }: AddInstanceDialogProps) {
  const [form, setForm] = useState<AddInstanceForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await axios.post("config", {
        federation: {
          instances: [{ name: form.name, url: form.url, token: form.token }],
        },
      });
      onAdded();
      toast.success(`Instance "${form.name}" added`, {
        position: "top-center",
      });
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Unknown error";
      toast.error(`Failed to add instance: ${msg}`, {
        position: "top-center",
      });
    } finally {
      setSaving(false);
    }
  }, [form, onAdded, onClose]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4 text-primary" />
            Add Federated Instance
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="inst-name" className="text-xs">
              Name
            </Label>
            <Input
              id="inst-name"
              className="h-9 text-xs"
              placeholder="Home NVR"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inst-url" className="text-xs">
              URL
            </Label>
            <Input
              id="inst-url"
              className="h-9 font-mono text-xs"
              placeholder="https://nvr.example.com"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inst-token" className="text-xs">
              Bearer Token
            </Label>
            <Input
              id="inst-token"
              type="password"
              className="h-9 font-mono text-xs"
              placeholder="sk-…"
              value={form.token}
              onChange={(e) =>
                setForm((f) => ({ ...f, token: e.target.value }))
              }
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="select"
            className="flex-1"
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.url.trim()}
          >
            {saving ? "Adding…" : "Add Instance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FederatedDashboard() {
  useEffect(() => {
    document.title = "Federation — Frigate";
  }, []);

  const {
    data: instances,
    mutate,
    isLoading,
  } = useSWR<FederatedInstance[]>("federation/instances", {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex size-full flex-col p-4">
      <Toaster position="top-center" />

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Federated Instances</h1>
          <p className="text-sm text-muted-foreground">
            Remote Frigate NVR instances — auto-refreshes every 30 s
          </p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="size-4" />
          Add Instance
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <ActivityIndicator />
        </div>
      ) : instances && instances.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {instances.map((inst) => (
            <InstanceCard key={inst.name} instance={inst} />
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Video className="size-14 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No federated instances configured.
          </p>
          <Button variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 size-4" />
            Add your first instance
          </Button>
        </div>
      )}

      {showAdd && (
        <AddInstanceDialog
          onClose={() => setShowAdd(false)}
          onAdded={() => mutate()}
        />
      )}
    </div>
  );
}

function InstanceCard({ instance }: { instance: FederatedInstance }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{instance.name}</p>
          <p className="truncate text-xs text-muted-foreground">{instance.url}</p>
        </div>
        <StatusDot status={instance.status} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Video className="size-3.5" />
          <span>{instance.cameras} cameras</span>
        </div>
        <div className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {instance.events_today}
          </span>{" "}
          events today
        </div>
      </div>

      <div className="mt-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            instance.status === "online"
              ? "bg-green-500/15 text-green-700 dark:text-green-400"
              : instance.status === "degraded"
                ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400",
          )}
        >
          <StatusDot status={instance.status} />
          {instance.status}
        </span>
      </div>
    </div>
  );
}
