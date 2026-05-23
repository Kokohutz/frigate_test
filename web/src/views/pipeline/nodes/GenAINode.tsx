import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MdAutoAwesome } from "react-icons/md";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type GenAINodeData = {
  label: string;
  provider: string;
  model: string;
  roles: string[];
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "text-orange-400",
  openai: "text-emerald-400",
  azure_openai: "text-blue-400",
  gemini: "text-yellow-400",
  ollama: "text-green-400",
  llamacpp: "text-lime-400",
  glm: "text-cyan-400",
  qwen: "text-purple-400",
};

export function GenAINode({ data, selected }: NodeProps) {
  const d = data as GenAINodeData;
  const color = PROVIDER_COLORS[d.provider] ?? "text-muted-foreground";

  return (
    <div
      className={cn(
        "min-w-[170px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? "border-green-500 shadow-md shadow-green-500/20"
          : "border-green-500/40",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "#22c55e" }}
      />

      <div className="flex items-center gap-2">
        <MdAutoAwesome className="size-3.5 shrink-0 text-green-500" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <Badge
          className={cn(
            "border-0 bg-green-500/10 px-1.5 py-0 text-[10px]",
            color,
          )}
        >
          {d.provider || "unset"}
        </Badge>
      </div>

      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {d.model}
      </p>

      {d.roles.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {d.roles.map((role) => (
            <Badge
              key={role}
              className="border-0 bg-muted px-1.5 py-0 text-[10px] text-muted-foreground hover:bg-muted"
            >
              {role}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
