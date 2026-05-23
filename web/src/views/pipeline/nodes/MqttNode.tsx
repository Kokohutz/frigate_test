import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MdOutlineHub } from "react-icons/md";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type MqttNodeData = {
  host: string;
  port: number;
  enabled: boolean;
};

export function MqttNode({ data, selected }: NodeProps) {
  const d = data as MqttNodeData;

  return (
    <div
      className={cn(
        "min-w-[150px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? "border-yellow-500 shadow-md shadow-yellow-500/20"
          : "border-yellow-500/40",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "#eab308" }}
      />

      <div className="flex items-center gap-2">
        <MdOutlineHub className="size-3.5 shrink-0 text-yellow-500" />
        <span className="truncate text-xs font-semibold">MQTT</span>
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

      {d.host && (
        <p className="mt-1 truncate text-[10px] text-muted-foreground">
          {d.host}:{d.port}
        </p>
      )}
    </div>
  );
}
