import { useCallback, useEffect, useState } from "react";
import { isDesktop, isMobile } from "react-device-detect";
import { QRCodeSVG } from "qrcode.react";
import axios from "axios";
import { toast } from "sonner";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  MobilePage,
  MobilePageContent,
  MobilePageDescription,
  MobilePageHeader,
  MobilePageTitle,
} from "../mobile/MobilePage";
import ActivityIndicator from "../indicators/activity-indicator";
import { cn } from "@/lib/utils";
import {
  LuCheck,
  LuCopy,
  LuDownload,
  LuKeyRound,
  LuShieldCheck,
  LuShieldOff,
} from "react-icons/lu";

type TwoFactorSetupDialogProps = {
  show: boolean;
  username: string;
  onClose: () => void;
  onEnrolled: () => void;
};

type Stage = "intro" | "scan" | "verify" | "recovery" | "done";

export default function TwoFactorSetupDialog({
  show,
  username,
  onClose,
  onEnrolled,
}: TwoFactorSetupDialogProps) {
  const [stage, setStage] = useState<Stage>("intro");
  const [secret, setSecret] = useState<string>("");
  const [uri, setUri] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  useEffect(() => {
    if (!show) {
      setStage("intro");
      setSecret("");
      setUri("");
      setCode("");
      setRecoveryCodes([]);
      setError(null);
      setCopiedSecret(false);
      setCopiedRecovery(false);
    }
  }, [show]);

  const beginSetup = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("2fa/setup");
      setSecret(res.data.secret);
      setUri(res.data.uri);
      setStage("scan");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message ?? "Failed to begin setup");
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyCode = useCallback(async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("2fa/enable", { code });
      setRecoveryCodes(res.data.recovery_codes ?? []);
      setStage("recovery");
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message ?? "Invalid code, try again");
    } finally {
      setLoading(false);
    }
  }, [code]);

  const finish = useCallback(() => {
    toast.success("Two-factor authentication enabled", {
      position: "top-center",
    });
    onEnrolled();
    onClose();
  }, [onClose, onEnrolled]);

  const copySecret = useCallback(() => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1500);
  }, [secret]);

  const copyRecoveryCodes = useCallback(() => {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopiedRecovery(true);
    setTimeout(() => setCopiedRecovery(false), 1500);
  }, [recoveryCodes]);

  const downloadRecoveryCodes = useCallback(() => {
    const blob = new Blob(
      [
        `Argus — Recovery codes for ${username}\n`,
        `Generated ${new Date().toISOString()}\n`,
        `\nEach code may be used ONCE if you lose your authenticator.\n\n`,
        recoveryCodes.join("\n"),
        "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `argus-recovery-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recoveryCodes, username]);

  const Overlay = isDesktop ? Dialog : MobilePage;
  const Content = isDesktop ? DialogContent : MobilePageContent;
  const Header = isDesktop ? DialogHeader : MobilePageHeader;
  const Description = isDesktop ? DialogDescription : MobilePageDescription;
  const Title = isDesktop ? DialogTitle : MobilePageTitle;

  return (
    <Overlay open={show} onOpenChange={onClose}>
      <Content
        className={cn(
          "scrollbar-container overflow-y-auto",
          isDesktop && "my-4 flex max-h-dvh flex-col sm:max-w-[460px]",
          isMobile && "px-4",
        )}
      >
        <Header className="mt-2" onClose={onClose}>
          <Title className="flex items-center gap-2">
            <LuShieldCheck className="size-5 text-primary" />
            Two-factor authentication
          </Title>
          <Description className={cn(!isDesktop && "sr-only")}>
            Protect <span className="font-mono">{username}</span> with a
            time-based one-time password.
          </Description>
        </Header>

        <div className="space-y-4 pt-4">
          {stage === "intro" && (
            <IntroStage
              onCancel={onClose}
              onContinue={beginSetup}
              loading={loading}
              error={error}
            />
          )}

          {stage === "scan" && (
            <ScanStage
              uri={uri}
              secret={secret}
              copiedSecret={copiedSecret}
              onCopy={copySecret}
              onBack={() => setStage("intro")}
              onContinue={() => setStage("verify")}
            />
          )}

          {stage === "verify" && (
            <VerifyStage
              code={code}
              setCode={setCode}
              error={error}
              loading={loading}
              onBack={() => setStage("scan")}
              onSubmit={verifyCode}
            />
          )}

          {stage === "recovery" && (
            <RecoveryStage
              codes={recoveryCodes}
              copied={copiedRecovery}
              onCopy={copyRecoveryCodes}
              onDownload={downloadRecoveryCodes}
              onFinish={finish}
            />
          )}
        </div>
      </Content>
    </Overlay>
  );
}

function IntroStage({
  onCancel,
  onContinue,
  loading,
  error,
}: {
  onCancel: () => void;
  onContinue: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <>
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm leading-relaxed">
        <p className="mb-3 font-medium">You'll need an authenticator app:</p>
        <ul className="ml-1 space-y-1.5 text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>1Password, Bitwarden, or Authy</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>Google Authenticator or Microsoft Authenticator</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>Any RFC 6238 compliant TOTP app</span>
          </li>
        </ul>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter className="flex gap-2 pt-2 sm:justify-end">
        <Button className="flex-1" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="select"
          className="flex-1"
          onClick={onContinue}
          disabled={loading}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <ActivityIndicator className="size-4" />
              Generating...
            </span>
          ) : (
            "Continue"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

function ScanStage({
  uri,
  secret,
  copiedSecret,
  onCopy,
  onBack,
  onContinue,
}: {
  uri: string;
  secret: string;
  copiedSecret: boolean;
  onCopy: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-xl border-2 border-border bg-white p-4">
          <QRCodeSVG value={uri} size={192} level="M" />
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Scan this QR code with your authenticator app.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Or enter this code manually
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onCopy}
          >
            {copiedSecret ? (
              <>
                <LuCheck className="size-3.5 text-green-500" />
                Copied
              </>
            ) : (
              <>
                <LuCopy className="size-3.5" />
                Copy
              </>
            )}
          </Button>
        </div>
        <code className="block break-all rounded-md bg-background px-3 py-2 font-mono text-sm tracking-wider">
          {secret}
        </code>
      </div>

      <DialogFooter className="flex gap-2 pt-2 sm:justify-end">
        <Button className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button variant="select" className="flex-1" onClick={onContinue}>
          I've scanned it
        </Button>
      </DialogFooter>
    </>
  );
}

function VerifyStage({
  code,
  setCode,
  error,
  loading,
  onBack,
  onSubmit,
}: {
  code: string;
  setCode: (v: string) => void;
  error: string | null;
  loading: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code from your authenticator to confirm enrollment.
      </p>
      <div className="flex justify-center">
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 6) onSubmit();
          }}
          placeholder="000000"
          className="w-48 rounded-lg border border-border bg-background px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter className="flex gap-2 pt-2 sm:justify-end">
        <Button className="flex-1" onClick={onBack} disabled={loading}>
          Back
        </Button>
        <Button
          variant="select"
          className="flex-1"
          disabled={code.length !== 6 || loading}
          onClick={onSubmit}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <ActivityIndicator className="size-4" />
              Verifying...
            </span>
          ) : (
            "Verify"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

function RecoveryStage({
  codes,
  copied,
  onCopy,
  onDownload,
  onFinish,
}: {
  codes: string[];
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onFinish: () => void;
}) {
  return (
    <>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
        <p className="font-medium">Save these recovery codes</p>
        <p className="mt-1 text-xs">
          Each code can be used once if you lose access to your authenticator.
          They will <strong>not</strong> be shown again.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-sm">
          {codes.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <LuKeyRound className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={onCopy}
        >
          {copied ? (
            <>
              <LuCheck className="size-3.5 text-green-500" />
              Copied
            </>
          ) : (
            <>
              <LuCopy className="size-3.5" />
              Copy all
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={onDownload}
        >
          <LuDownload className="size-3.5" />
          Download .txt
        </Button>
      </div>

      <DialogFooter className="flex gap-2 pt-2 sm:justify-end">
        <Button variant="select" className="w-full" onClick={onFinish}>
          I've saved my codes — finish
        </Button>
      </DialogFooter>
    </>
  );
}

export function TwoFactorDisableConfirm({
  show,
  username,
  onCancel,
  onConfirm,
}: {
  show: boolean;
  username: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={show} onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LuShieldOff className="size-5 text-destructive" />
            Disable two-factor authentication?
          </DialogTitle>
          <DialogDescription>
            This removes the TOTP secret and recovery codes for{" "}
            <span className="font-mono">{username}</span>. They will sign in
            with just a password until 2FA is re-enrolled.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 pt-2">
          <Button className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" className="flex-1" onClick={onConfirm}>
            Disable 2FA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
