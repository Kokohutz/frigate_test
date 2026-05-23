import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  MdOutlineForwardToInbox,
  MdOutlineSpeed,
  MdWebhook,
} from "react-icons/md";
import { SiDiscord, SiSlack, SiTelegram } from "react-icons/si";

type RouterConfig = {
  webhook: { enabled: boolean; url: string };
  discord: { enabled: boolean; url: string };
  slack: { enabled: boolean; url: string };
  telegram: { enabled: boolean; token: string; chatId: string };
  mqtt: { enabled: boolean; host: string; port: number; prefix: string };
  rateLimit: number;
};

type Props = {
  value: RouterConfig;
  onClose: () => void;
  onSave: (next: RouterConfig) => void;
};

export function EventRouterDialog({ value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<RouterConfig>(value);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="scrollbar-container max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MdOutlineForwardToInbox className="size-5 text-fuchsia-500" />
            Event Router
          </DialogTitle>
          <DialogDescription>
            Forward Argus events to external services. Token-bucket rate
            limiting and a dead-letter queue keep your downstream apps safe.
            Powered by the Rust{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              event-router
            </code>{" "}
            daemon.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <SinkCard
            title="Webhook"
            icon={<MdWebhook className="size-4 text-violet-400" />}
            enabled={draft.webhook.enabled}
            onToggle={(v) =>
              setDraft({ ...draft, webhook: { ...draft.webhook, enabled: v } })
            }
          >
            <div>
              <Label className="text-xs">URL</Label>
              <Input
                placeholder="https://example.com/argus-events"
                className="h-9 font-mono text-xs"
                value={draft.webhook.url}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    webhook: { ...draft.webhook, url: e.target.value },
                  })
                }
              />
            </div>
          </SinkCard>

          <SinkCard
            title="Discord"
            icon={<SiDiscord className="size-4 text-indigo-400" />}
            enabled={draft.discord.enabled}
            onToggle={(v) =>
              setDraft({ ...draft, discord: { ...draft.discord, enabled: v } })
            }
          >
            <div>
              <Label className="text-xs">Webhook URL</Label>
              <Input
                placeholder="https://discord.com/api/webhooks/..."
                className="h-9 font-mono text-xs"
                value={draft.discord.url}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    discord: { ...draft.discord, url: e.target.value },
                  })
                }
              />
            </div>
          </SinkCard>

          <SinkCard
            title="Slack"
            icon={<SiSlack className="size-4 text-emerald-400" />}
            enabled={draft.slack.enabled}
            onToggle={(v) =>
              setDraft({ ...draft, slack: { ...draft.slack, enabled: v } })
            }
          >
            <div>
              <Label className="text-xs">Webhook URL</Label>
              <Input
                placeholder="https://hooks.slack.com/services/..."
                className="h-9 font-mono text-xs"
                value={draft.slack.url}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    slack: { ...draft.slack, url: e.target.value },
                  })
                }
              />
            </div>
          </SinkCard>

          <SinkCard
            title="Telegram"
            icon={<SiTelegram className="size-4 text-sky-400" />}
            enabled={draft.telegram.enabled}
            onToggle={(v) =>
              setDraft({
                ...draft,
                telegram: { ...draft.telegram, enabled: v },
              })
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Bot token</Label>
                <Input
                  type="password"
                  placeholder="123456:ABC-..."
                  className="h-9 font-mono text-xs"
                  value={draft.telegram.token}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      telegram: {
                        ...draft.telegram,
                        token: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Chat ID</Label>
                <Input
                  placeholder="-100..."
                  className="h-9 font-mono text-xs"
                  value={draft.telegram.chatId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      telegram: {
                        ...draft.telegram,
                        chatId: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>
          </SinkCard>

          <SinkCard
            title="External MQTT"
            icon={
              <MdOutlineForwardToInbox className="size-4 text-yellow-400" />
            }
            enabled={draft.mqtt.enabled}
            onToggle={(v) =>
              setDraft({ ...draft, mqtt: { ...draft.mqtt, enabled: v } })
            }
          >
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">Host</Label>
                <Input
                  placeholder="mqtt.example.com"
                  className="h-9 font-mono text-xs"
                  value={draft.mqtt.host}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      mqtt: { ...draft.mqtt, host: e.target.value },
                    })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Port</Label>
                <Input
                  className="h-9 font-mono text-xs"
                  value={draft.mqtt.port}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      mqtt: {
                        ...draft.mqtt,
                        port: Number(e.target.value) || 1883,
                      },
                    })
                  }
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Topic prefix</Label>
                <Input
                  className="h-9 font-mono text-xs"
                  value={draft.mqtt.prefix}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      mqtt: { ...draft.mqtt, prefix: e.target.value },
                    })
                  }
                />
              </div>
            </div>
          </SinkCard>

          <section className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="mb-3 flex items-center gap-2">
              <MdOutlineSpeed className="size-4 text-amber-500" />
              <h4 className="text-sm font-semibold">Rate limit</h4>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-xs">Maximum events per minute</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {draft.rateLimit}/min
                </span>
              </div>
              <Slider
                value={[draft.rateLimit]}
                min={1}
                max={300}
                step={1}
                onValueChange={([v]) => setDraft({ ...draft, rateLimit: v })}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Excess events are dropped into the dead-letter queue at{" "}
                <code className="font-mono">/config/argus_dlq.db</code> for
                replay.
              </p>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="select"
            className="flex-1"
            onClick={() => onSave(draft)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SinkCard({
  title,
  icon,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors",
        enabled ? "border-fuchsia-500/40" : "border-border",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h4 className="text-sm font-semibold">{title}</h4>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="ml-auto"
        />
      </div>
      <div
        className={cn(
          "space-y-2 transition-opacity",
          !enabled && "pointer-events-none opacity-40",
        )}
      >
        {children}
      </div>
    </section>
  );
}
