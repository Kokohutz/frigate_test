import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FaHdd } from "react-icons/fa";

type TierConfig = {
  enabled: boolean;
  hot: { path: string; maxDays: number; maxGb: number };
  cold: { path: string; maxDays: number };
};

type Props = {
  value: TierConfig;
  onClose: () => void;
  onSave: (next: TierConfig) => void;
};

export function TieredStorageDialog({ value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<TierConfig>(value);

  const update = <K extends keyof TierConfig>(key: K, val: TierConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="scrollbar-container max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FaHdd className="size-4 text-red-500" />
            Storage Tiers
          </DialogTitle>
          <DialogDescription>
            Migrate older recordings from fast NVMe/SSD to cheap HDD/NAS
            automatically. Powered by the Rust{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              tiered-storage
            </code>{" "}
            daemon.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Enable tiered storage</p>
              <p className="text-xs text-muted-foreground">
                When off, recordings stay on a single volume.
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v) => update("enabled", v)}
            />
          </div>

          <div
            className={cn(
              "space-y-5 transition-opacity",
              !draft.enabled && "pointer-events-none opacity-40",
            )}
          >
            <section className="rounded-lg border-2 border-red-500/30 bg-red-500/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2">
                <FaHdd className="size-4 text-red-500" />
                <h4 className="text-sm font-semibold">Hot Tier — NVMe/SSD</h4>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Path</Label>
                  <Input
                    className="h-9 font-mono text-xs"
                    value={draft.hot.path}
                    onChange={(e) =>
                      update("hot", { ...draft.hot, path: e.target.value })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label className="text-xs">Max retention</Label>
                    <span className="font-mono text-xs text-muted-foreground">
                      {draft.hot.maxDays} days
                    </span>
                  </div>
                  <Slider
                    value={[draft.hot.maxDays]}
                    min={1}
                    max={30}
                    step={1}
                    onValueChange={([v]) =>
                      update("hot", { ...draft.hot, maxDays: v })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label className="text-xs">Max disk usage</Label>
                    <span className="font-mono text-xs text-muted-foreground">
                      {draft.hot.maxGb} GB
                    </span>
                  </div>
                  <Slider
                    value={[draft.hot.maxGb]}
                    min={50}
                    max={4000}
                    step={50}
                    onValueChange={([v]) =>
                      update("hot", { ...draft.hot, maxGb: v })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="rounded-lg border-2 border-sky-500/30 bg-sky-500/[0.03] p-4">
              <div className="mb-3 flex items-center gap-2">
                <FaHdd className="size-4 text-sky-500" />
                <h4 className="text-sm font-semibold">Cold Tier — HDD/NAS</h4>
              </div>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Path</Label>
                  <Input
                    className="h-9 font-mono text-xs"
                    value={draft.cold.path}
                    onChange={(e) =>
                      update("cold", { ...draft.cold, path: e.target.value })
                    }
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label className="text-xs">Max retention</Label>
                    <span className="font-mono text-xs text-muted-foreground">
                      {draft.cold.maxDays} days
                    </span>
                  </div>
                  <Slider
                    value={[draft.cold.maxDays]}
                    min={7}
                    max={365}
                    step={1}
                    onValueChange={([v]) =>
                      update("cold", { ...draft.cold, maxDays: v })
                    }
                  />
                </div>
              </div>
            </section>

            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
              Migration runs every hour. Files copy-then-unlink so it's safe
              across filesystems. The{" "}
              <code className="font-mono">Recordings.path</code> column is
              updated atomically in WAL mode.
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="select"
            className="flex-1"
            onClick={() => onSave(draft)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
