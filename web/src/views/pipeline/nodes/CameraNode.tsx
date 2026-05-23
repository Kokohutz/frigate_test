import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FaVideo } from "react-icons/fa";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type CameraNodeData = {
  label: string;
  enabled: boolean;
  detectEnabled: boolean;
  recordEnabled: boolean;
  genaiEnabled: boolean;
  fps: number;
};

export function CameraNode({ data, selected }: NodeProps) {
  const d = data as CameraNodeData;

  return (
    <div
      className={cn(
        "min-w-[160px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? "border-blue-500 shadow-md shadow-blue-500/20"
          : "border-blue-500/40",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <FaVideo className="size-3.5 shrink-0 text-blue-500" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
        <Badge
          className={cn(
            "ml-auto shrink-0 px-1.5 py-0 text-[10px]",
            d.enabled
              ? "bg-green-500/20 text-green-400 hover:bg-green-500/20"
              : "bg-muted text-muted-foreground hover:bg-muted",
          )}
        >
          {d.enabled ? "on" : "off"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {d.detectEnabled && (
          <Badge className="bg-blue-500/20 px-1.5 py-0 text-[10px] text-blue-400 hover:bg-blue-500/20">
            detect
          </Badge>
        )}
        {d.recordEnabled && (
          <Badge className="bg-orange-500/20 px-1.5 py-0 text-[10px] text-orange-400 hover:bg-orange-500/20">
            record
          </Badge>
        )}
        {d.genaiEnabled && (
          <Badge className="bg-green-500/20 px-1.5 py-0 text-[10px] text-green-400 hover:bg-green-500/20">
            AI
          </Badge>
        )}
      </div>

      {d.fps > 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">{d.fps} fps</p>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="detect"
        style={{ top: "30%", background: "#3b82f6" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="record"
        style={{ top: "60%", background: "#f97316" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="genai"
        style={{ top: "88%", background: "#22c55e" }}
      />
    </div>
  );
}
