import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FaHdd } from "react-icons/fa";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TieredStorageNodeData = {
  label: string;
  tier: "hot" | "cold";
  path: string;
  maxDays?: number;
  maxGb?: number;
};

const TIER_STYLES = {
  hot: {
    border: "border-red-500",
    borderSoft: "border-red-500/40",
    text: "text-red-500",
    handle: "#ef4444",
    label: "NVMe / SSD",
    badge: "bg-red-500/20 text-red-400 hover:bg-red-500/20",
  },
  cold: {
    border: "border-sky-500",
    borderSoft: "border-sky-500/40",
    text: "text-sky-500",
    handle: "#0ea5e9",
    label: "HDD / NAS",
    badge: "bg-sky-500/20 text-sky-400 hover:bg-sky-500/20",
  },
};

export function TieredStorageNode({ data, selected }: NodeProps) {
  const d = data as TieredStorageNodeData;
  const style = TIER_STYLES[d.tier];

  return (
    <div
      className={cn(
        "min-w-[170px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? `${style.border} shadow-current/20 shadow-md`
          : style.borderSoft,
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: style.handle }}
      />

      <div className="flex items-center gap-2">
        <FaHdd className={cn("size-3 shrink-0", style.text)} />
        <span className="truncate text-xs font-semibold">{d.label}</span>
        <Badge
          className={cn(
            "ml-auto shrink-0 px-1.5 py-0 text-[10px]",
            style.badge,
          )}
        >
          {d.tier}
        </Badge>
      </div>

      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {d.path}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {style.label}
        {d.maxDays ? ` · ${d.maxDays}d` : ""}
        {d.maxGb ? ` · ${d.maxGb} GB` : ""}
      </p>
    </div>
  );
}
