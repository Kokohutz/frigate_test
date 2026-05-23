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

const DETECTOR_TYPES = [
  "cpu_tfl",
  "edgetpu",
  "hailo8l",
  "onnx",
  "openvino",
  "synaptics",
  "tensorrt",
];

type AddDetectorDialogProps = {
  onClose: () => void;
  onCreated: () => void;
};

export function AddDetectorDialog({
  onClose,
  onCreated,
}: AddDetectorDialogProps) {
  const [name, setName] = useState("");
  const [detectorType, setDetectorType] = useState("");
  const [device, setDevice] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !detectorType) {
      toast.error("Name and type are required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { type: detectorType };
      if (device.trim()) payload.device = device.trim();
      await axios.put("config/set", {
        path: `detectors.${name.trim()}`,
        value: payload,
      });
      toast.success(`Detector "${name}" created.`);
      onCreated();
    } catch {
      toast.error("Failed to create detector.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Detector</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <Row label="Name">
            <Input
              className="h-7 text-xs"
              placeholder="e.g. my_detector"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Row>
          <Row label="Type">
            <Select value={detectorType} onValueChange={setDetectorType}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select type" />
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
          <Row label="Device">
            <Input
              className="h-7 text-xs"
              placeholder="e.g. 0 or /dev/apex_0 (optional)"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            />
          </Row>
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
