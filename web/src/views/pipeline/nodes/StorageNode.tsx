import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FaDatabase } from "react-icons/fa";
import { cn } from "@/lib/utils";

export type StorageNodeData = {
  label: string;
  retainDays: number;
  path: string;
};

export function StorageNode({ data, selected }: NodeProps) {
  const d = data as StorageNodeData;

  return (
    <div
      className={cn(
        "min-w-[150px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? "border-orange-500 shadow-md shadow-orange-500/20"
          : "border-orange-500/40",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "#f97316" }}
      />

      <div className="flex items-center gap-2">
        <FaDatabase className="size-3 shrink-0 text-orange-500" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
      </div>

      {d.path && (
        <p className="mt-1 truncate text-[10px] text-muted-foreground">
          {d.path}
        </p>
      )}

      {d.retainDays > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {d.retainDays}d retain
        </p>
      )}
    </div>
  );
}
