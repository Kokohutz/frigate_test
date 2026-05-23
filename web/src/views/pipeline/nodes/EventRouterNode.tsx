import { Handle, Position, type NodeProps } from "@xyflow/react";
import { MdOutlineForwardToInbox, MdWebhook } from "react-icons/md";
import { SiDiscord, SiSlack, SiTelegram } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type EventSink = {
  type: "webhook" | "discord" | "slack" | "telegram" | "mqtt";
  enabled: boolean;
  label?: string;
};

export type EventRouterNodeData = {
  label: string;
  sinks: EventSink[];
  rateLimit?: number;
};

const SINK_META: Record<
  EventSink["type"],
  { icon: typeof SiDiscord; color: string }
> = {
  webhook: { icon: MdWebhook, color: "text-violet-400" },
  discord: { icon: SiDiscord, color: "text-indigo-400" },
  slack: { icon: SiSlack, color: "text-emerald-400" },
  telegram: { icon: SiTelegram, color: "text-sky-400" },
  mqtt: { icon: MdOutlineForwardToInbox, color: "text-yellow-400" },
};

export function EventRouterNode({ data, selected }: NodeProps) {
  const d = data as EventRouterNodeData;
  const enabledCount = d.sinks.filter((s) => s.enabled).length;

  return (
    <div
      className={cn(
        "min-w-[180px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
        selected
          ? "border-fuchsia-500 shadow-md shadow-fuchsia-500/20"
          : "border-fuchsia-500/40",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "#d946ef" }}
      />

      <div className="flex items-center gap-2">
        <MdOutlineForwardToInbox className="size-3.5 shrink-0 text-fuchsia-500" />
        <span className="truncate text-xs font-semibold">{d.label}</span>
        <Badge
          className={cn(
            "ml-auto shrink-0 px-1.5 py-0 text-[10px]",
            enabledCount > 0
              ? "bg-fuchsia-500/20 text-fuchsia-400 hover:bg-fuchsia-500/20"
              : "bg-muted text-muted-foreground hover:bg-muted",
          )}
        >
          {enabledCount}/{d.sinks.length}
        </Badge>
      </div>

      <div className="mt-1.5 flex gap-1.5">
        {d.sinks.map((sink) => {
          const meta = SINK_META[sink.type];
          const Icon = meta.icon;
          return (
            <div
              key={sink.type}
              title={`${sink.type} — ${sink.enabled ? "enabled" : "disabled"}`}
              className={cn(
                "flex size-5 items-center justify-center rounded",
                sink.enabled
                  ? `bg-card-foreground/5 ${meta.color}`
                  : "bg-card-foreground/5 text-muted-foreground/40",
              )}
            >
              <Icon className="size-3" />
            </div>
          );
        })}
      </div>

      {d.rateLimit ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {d.rateLimit}/min limit
        </p>
      ) : null}
    </div>
  );
}
