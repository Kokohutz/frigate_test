import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { LockKeyhole, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import axios from "axios";
import { toast } from "sonner";

export type EncryptedStorageNodeData = {
  label: string;
  cipher?: string;
  keyId?: string;
  compression?: boolean;
};

type EncryptionConfig = {
  cipher: "aes-256-gcm" | "chacha20-poly1305";
  keyId: string;
  compression: boolean;
};

type EncryptionDialogProps = {
  initial: EncryptionConfig;
  onClose: () => void;
  onSaved: (cfg: EncryptionConfig) => void;
};

function EncryptionDialog({ initial, onClose, onSaved }: EncryptionDialogProps) {
  const [draft, setDraft] = useState<EncryptionConfig>(initial);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.put("config/encrypted_storage", draft);
      onSaved(draft);
      toast.success("Encrypted storage configuration saved", {
        position: "top-center",
      });
      onClose();
    } catch (err: unknown) {
      const errMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Unknown error";
      toast.error(`Failed to save: ${errMsg}`, { position: "top-center" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-emerald-500" />
            Encrypted Storage
          </DialogTitle>
          <DialogDescription>
            Configure AES-256-GCM or ChaCha20-Poly1305 at-rest encryption for
            recordings. Powered by the Rust{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              encrypted-storage
            </code>{" "}
            daemon.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cipher" className="text-xs">
              Cipher
            </Label>
            <Select
              value={draft.cipher}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  cipher: v as EncryptionConfig["cipher"],
                }))
              }
            >
              <SelectTrigger id="cipher" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aes-256-gcm" className="text-xs">
                  AES-256-GCM (hardware-accelerated)
                </SelectItem>
                <SelectItem value="chacha20-poly1305" className="text-xs">
                  ChaCha20-Poly1305 (software-friendly)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="keyId" className="text-xs">
              Key ID
            </Label>
            <Input
              id="keyId"
              className="h-9 font-mono text-xs"
              placeholder="e.g. frigate-key-01"
              value={draft.keyId}
              onChange={(e) => setDraft((d) => ({ ...d, keyId: e.target.value }))}
            />
            <p className="text-[10px] text-muted-foreground">
              References a key in your key-management store.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Enable compression</p>
              <p className="text-xs text-muted-foreground">
                Compress before encrypting (zstd). Reduces storage at a small
                CPU cost.
              </p>
            </div>
            <Switch
              checked={draft.compression}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, compression: v }))}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button className="flex-1" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="select"
            className="flex-1"
            onClick={handleSave}
            disabled={saving || !draft.keyId.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EncryptedStorageNode({ data, selected }: NodeProps) {
  const d = data as EncryptedStorageNodeData;
  const [showDialog, setShowDialog] = useState(false);
  const [cipher, setCipher] = useState<EncryptionConfig["cipher"]>(
    (d.cipher as EncryptionConfig["cipher"]) ?? "aes-256-gcm",
  );
  const [keyId, setKeyId] = useState(d.keyId ?? "");
  const [compression, setCompression] = useState(d.compression ?? false);

  return (
    <>
      <div
        className={cn(
          "min-w-[160px] rounded-lg border-2 bg-card px-3 py-2 shadow-sm transition-shadow",
          selected
            ? "border-emerald-500 shadow-md shadow-emerald-500/20"
            : "border-emerald-500/40",
        )}
      >
        <Handle
          type="target"
          position={Position.Left}
          style={{ background: "#10b981" }}
        />

        <div className="mb-1.5 flex items-center gap-2">
          <LockKeyhole className="size-3.5 shrink-0 text-emerald-500" />
          <span className="truncate text-xs font-semibold">{d.label}</span>
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-5 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setShowDialog(true);
            }}
          >
            <Settings className="size-3" />
          </Button>
        </div>

        {cipher && (
          <Badge className="bg-emerald-500/20 px-1.5 py-0 text-[10px] text-emerald-400 hover:bg-emerald-500/20">
            {cipher}
          </Badge>
        )}
        {keyId && (
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            key: {keyId}
          </p>
        )}
        {compression && (
          <p className="text-[10px] text-muted-foreground">+zstd</p>
        )}
      </div>

      {showDialog && (
        <EncryptionDialog
          initial={{ cipher, keyId, compression }}
          onClose={() => setShowDialog(false)}
          onSaved={(cfg) => {
            setCipher(cfg.cipher);
            setKeyId(cfg.keyId);
            setCompression(cfg.compression);
          }}
        />
      )}
    </>
  );
}
