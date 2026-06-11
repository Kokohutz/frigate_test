import useSWR from "swr";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { cn } from "@/lib/utils";

type CheckStatus = "pass" | "warn" | "fail";

type CheckResult = {
  status: CheckStatus;
  message: string;
  duration_ms: number;
};

type HealthResponse = {
  overall: "healthy" | "degraded" | "critical";
  timestamp: string;
  checks: Record<string, CheckResult>;
};

const CHECK_LABELS: Record<string, string> = {
  database: "Database (SQLite)",
  config: "Configuration",
  storage_recordings: "Storage · recordings",
  storage_cache: "Storage · cache",
  storage_hot: "Storage · hot tier",
  storage_cold: "Storage · cold tier",
  rust_storage_daemon: "storage-daemon",
  rust_comms_dispatcher: "comms-dispatcher",
  rust_encrypted_storage: "encrypted-storage",
  rust_tiered_storage: "tiered-storage",
  rust_event_router: "event-router",
};

// Preferred display order
const CHECK_ORDER = [
  "database",
  "config",
  "storage_recordings",
  "storage_cache",
  "storage_hot",
  "storage_cold",
  "rust_storage_daemon",
  "rust_comms_dispatcher",
  "rust_encrypted_storage",
  "rust_tiered_storage",
  "rust_event_router",
];

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pass")
    return <CheckCircle2 className="size-4 shrink-0 text-green-500" />;
  if (status === "warn")
    return <AlertTriangle className="size-4 shrink-0 text-yellow-500" />;
  return <XCircle className="size-4 shrink-0 text-destructive" />;
}

function OverallBadge({
  overall,
  count,
}: {
  overall: HealthResponse["overall"];
  count: number;
}) {
  if (overall === "healthy")
    return (
      <Badge
        variant="outline"
        className="border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
      >
        <CheckCircle2 className="mr-1.5 size-3" />
        {count} checks passed
      </Badge>
    );
  if (overall === "degraded")
    return (
      <Badge
        variant="outline"
        className="border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
      >
        <AlertTriangle className="mr-1.5 size-3" />
        Degraded
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="border-destructive/40 bg-destructive/10 text-destructive"
    >
      <XCircle className="mr-1.5 size-3" />
      Critical
    </Badge>
  );
}

export default function SystemHealthPanel() {
  const [open, setOpen] = useState<boolean>(false);
  const {
    data,
    isLoading,
    mutate,
    isValidating,
  } = useSWR<HealthResponse>("health", {
    refreshInterval: 30_000,
    revalidateOnFocus: false,
  });

  if (isLoading) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-secondary px-4 py-3 text-sm text-muted-foreground">
        <RefreshCw className="size-4 animate-spin" />
        Running startup checks…
      </div>
    );
  }

  if (!data) return null;

  const entries = CHECK_ORDER.filter((k) => k in data.checks).map(
    (k) => [k, data.checks[k]] as [string, CheckResult],
  );
  // Append any keys not in CHECK_ORDER (future-proofing)
  Object.entries(data.checks).forEach(([k, v]) => {
    if (!CHECK_ORDER.includes(k)) entries.push([k, v]);
  });

  const failCount = entries.filter(([, c]) => c.status === "fail").length;
  const warnCount = entries.filter(([, c]) => c.status === "warn").length;

  return (
    <div className="mb-3 rounded-lg border border-secondary">
      {/* Header row — always visible */}
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-secondary/30 transition-colors rounded-lg"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <OverallBadge overall={data.overall} count={entries.length} />
          {(failCount > 0 || warnCount > 0) && (
            <span className="text-muted-foreground">
              {failCount > 0 && (
                <span className="text-destructive font-medium">
                  {failCount} failing
                </span>
              )}
              {failCount > 0 && warnCount > 0 && (
                <span className="text-muted-foreground">, </span>
              )}
              {warnCount > 0 && (
                <span className="text-yellow-500 dark:text-yellow-400 font-medium">
                  {warnCount} warning{warnCount !== 1 ? "s" : ""}
                </span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <button
            title="Refresh checks"
            onClick={(e) => {
              e.stopPropagation();
              mutate();
            }}
            className={cn(
              "rounded p-1 hover:bg-secondary transition-colors",
              isValidating && "opacity-50 pointer-events-none",
            )}
          >
            <RefreshCw
              className={cn("size-3.5", isValidating && "animate-spin")}
            />
          </button>
          {open ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </div>
      </button>

      {/* Expanded check rows */}
      {open && (
        <div className="divide-y divide-secondary border-t border-secondary">
          {entries.map(([key, check]) => (
            <div
              key={key}
              className="flex items-start gap-3 px-4 py-2.5 text-sm"
            >
              <StatusIcon status={check.status} />
              <span className="w-48 shrink-0 font-medium text-primary/90">
                {CHECK_LABELS[key] ?? key}
              </span>
              <span className="grow text-muted-foreground leading-snug">
                {check.message}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground/60">
                {check.duration_ms}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
