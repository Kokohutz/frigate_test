import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MdOutlineMemory } from "react-icons/md";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DetectorNodeData = {
  label: string;
  detectorType: string;
  device?: string;
};

const DETECTOR_COLORS: Record<string, string> = {
  tensorrt: "text-green-400",
  openvino: "text-blue-400",
  synaptics: "text-purple-400",
  onnx: "text-cyan-400",
  edgetpu: "text-yellow-400",
  hailo8l: "text-pink-400",
  cpu_tfl: "text-muted-foreground",
};

export function DetectorNode({ data, selected }: NodeProps) {
  const d = data as DetectorNodeData;
  const color = DETECTOR_COLORS[d.detectorType] ?? "text-muted-foreground";

  return (
    <div
      className={cn(
        "min-w-[150px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? "border-purple-500 shadow-md shadow-purple-500/20"
          : "border-purple-500/40",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "#3b82f6" }}
      />

      <div className="flex items-center gap-2">
        <MdOutlineMemory className="size-3.5 shrink-0 text-purple-500" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
      </div>

      <Badge
        className={cn(
          "mt-1.5 border-0 px-1.5 py-0 text-[10px]",
          "bg-purple-500/10",
          color,
        )}
      >
        {d.detectorType}
      </Badge>

      {d.device && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{d.device}</p>
      )}
    </div>
  );
}
