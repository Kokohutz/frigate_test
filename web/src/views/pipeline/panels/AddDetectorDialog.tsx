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
import { cn } from "@/lib/utils";
import { MdMemory, MdSpeed, MdBolt, MdCloud } from "react-icons/md";

type DetectorOption = {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  defaultDevice: string;
  recommendedModel: string;
};

const DETECTORS: DetectorOption[] = [
  {
    id: "edgetpu",
    label: "Coral EdgeTPU",
    hint: "4 TOPS · USB or PCIe",
    icon: <MdBolt className="size-4 text-yellow-400" />,
    defaultDevice: "usb",
    recommendedModel: "ssd",
  },
  {
    id: "tensorrt",
    label: "TensorRT",
    hint: "NVIDIA GPU",
    icon: <MdBolt className="size-4 text-green-400" />,
    defaultDevice: "0",
    recommendedModel: "yolov8",
  },
  {
    id: "openvino",
    label: "OpenVINO",
    hint: "Intel CPU / iGPU",
    icon: <MdMemory className="size-4 text-blue-400" />,
    defaultDevice: "AUTO",
    recommendedModel: "yolov8",
  },
  {
    id: "hailo8l",
    label: "Hailo-8L",
    hint: "13 TOPS NPU",
    icon: <MdBolt className="size-4 text-pink-400" />,
    defaultDevice: "0",
    recommendedModel: "yolov8",
  },
  {
    id: "synaptics",
    label: "Synaptics SL1680",
    hint: "7.9 TOPS NPU",
    icon: <MdBolt className="size-4 text-purple-400" />,
    defaultDevice: "0",
    recommendedModel: "ssd",
  },
  {
    id: "onnx",
    label: "ONNX Runtime",
    hint: "Cross-platform",
    icon: <MdCloud className="size-4 text-cyan-400" />,
    defaultDevice: "",
    recommendedModel: "yolov8",
  },
  {
    id: "cpu_tfl",
    label: "CPU TFLite",
    hint: "Fallback (slow)",
    icon: <MdSpeed className="size-4 text-muted-foreground" />,
    defaultDevice: "",
    recommendedModel: "ssd",
  },
];

const MODEL_TYPES = ["ssd", "yolov8", "yolov9", "yolonas", "yologeneric"];
const INPUT_SIZES = [256, 300, 320, 416, 480, 640];

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function AddDetectorDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [detectorId, setDetectorId] = useState("");
  const [device, setDevice] = useState("");
  const [modelType, setModelType] = useState("ssd");
  const [inputSize, setInputSize] = useState(320);
  const [threshold, setThreshold] = useState(0.5);
  const [saving, setSaving] = useState(false);

  const det = useMemo(
    () => DETECTORS.find((d) => d.id === detectorId),
    [detectorId],
  );

  function selectDetector(d: DetectorOption) {
    setDetectorId(d.id);
    if (!device) setDevice(d.defaultDevice);
    setModelType(d.recommendedModel);
  }

  async function handleCreate() {
    if (!name.trim() || !detectorId) {
      toast.error("Name and type are required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type: detectorId,
        model: {
          model_type: modelType,
          width: inputSize,
          height: inputSize,
          score_threshold: threshold,
        },
      };
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="text-sm">Add Detector</DialogTitle>
          <DialogDescription className="text-xs">
            Pick a backend that matches your hardware.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-4">
          <div>
            <Label className="mb-1.5 block text-xs font-medium">
              Detector name
            </Label>
            <Input
              className="h-8 text-xs"
              placeholder="my_detector"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <Label className="mb-2 block text-xs font-medium">Backend</Label>
            <div className="grid grid-cols-2 gap-2">
              {DETECTORS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => selectDetector(d)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border-2 px-3 py-2 text-left transition-all",
                    detectorId === d.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/50",
                  )}
                >
                  <div className="flex w-full items-center gap-1.5">
                    {d.icon}
                    <span className="text-xs font-semibold">{d.label}</span>
                  </div>
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    {d.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {det && (
            <>
              <div>
                <Label className="mb-1.5 block text-xs font-medium">
                  Device
                </Label>
                <Input
                  className="h-8 text-xs"
                  placeholder={det.defaultDevice || "auto"}
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Default for {det.label}:{" "}
                  <code>{det.defaultDevice || "auto"}</code>
                </p>
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-card/30 p-3">
                <div>
                  <Label className="mb-1.5 block text-xs font-medium">
                    Model type
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {MODEL_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setModelType(t)}
                        className={cn(
                          "rounded px-2 py-1 font-mono text-[11px] transition-colors",
                          modelType === t
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80",
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="mb-1.5 block text-xs font-medium">
                    Input size
                  </Label>
                  <div className="flex gap-1 rounded-md border border-border bg-card p-0.5">
                    {INPUT_SIZES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setInputSize(s)}
                        className={cn(
                          "flex-1 rounded px-2 py-1 font-mono text-[11px] transition-colors",
                          inputSize === s
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Larger = more accurate, slower. Common: 320 (SSD), 640
                    (YOLO).
                  </p>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Label className="text-xs font-medium">
                      Score threshold
                    </Label>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {threshold.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={[threshold]}
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    onValueChange={(v) => setThreshold(v[0])}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Minimum confidence to count as a detection.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create detector"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
