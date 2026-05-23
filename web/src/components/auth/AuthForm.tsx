"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";

import { baseUrl } from "../../api/baseUrl";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ActivityIndicator from "@/components/indicators/activity-indicator";
import axios, { AxiosError } from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AuthContext } from "@/context/auth-context";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { LuExternalLink, LuShield } from "react-icons/lu";
import { MdLockOutline, MdArrowBack } from "react-icons/md";
import { useDocDomain } from "@/hooks/use-doc-domain";
import { Card, CardContent } from "@/components/ui/card";

type Stage = "credentials" | "totp" | "recovery";

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {}

export function UserAuthForm({ className, ...props }: UserAuthFormProps) {
  const { t } = useTranslation(["components/auth", "common"]);
  const { getLocaleDocUrl } = useDocDomain();
  const [isLoading, setIsLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("credentials");
  const [challenge, setChallenge] = useState<string>("");
  const [usernameForDisplay, setUsernameForDisplay] = useState<string>("");
  const { login } = React.useContext(AuthContext);

  const fetcher = (path: string) => axios.get(path).then((res) => res.data);
  const { data } = useSWR("/auth/first_time_login", fetcher);
  const showFirstTimeLink = data?.admin_first_time_login === true;

  const credSchema = z.object({
    user: z.string().min(1, t("form.errors.usernameRequired")),
    password: z.string().min(1, t("form.errors.passwordRequired")),
  });

  const credForm = useForm<z.infer<typeof credSchema>>({
    resolver: zodResolver(credSchema),
    mode: "onChange",
    defaultValues: { user: "", password: "" },
  });

  async function completeLogin() {
    const profileRes = await axios.get("/profile", { withCredentials: true });
    login({
      username: profileRes.data.username,
      role: profileRes.data.role || "viewer",
    });
    window.location.href = baseUrl;
  }

  function handleAxiosError(error: unknown) {
    if (axios.isAxiosError(error)) {
      const err = error as AxiosError;
      if (err.response?.status === 429) {
        toast.error(t("form.errors.rateLimit"), { position: "top-center" });
      } else if (err.response?.status === 401) {
        toast.error(t("form.errors.loginFailed"), { position: "top-center" });
      } else {
        toast.error(t("form.errors.unknownError"), { position: "top-center" });
      }
    } else {
      toast.error(t("form.errors.webUnknownError"), { position: "top-center" });
    }
  }

  const onCredSubmit = async (values: z.infer<typeof credSchema>) => {
    setIsLoading(true);
    try {
      const res = await axios.post(
        "/login",
        { user: values.user, password: values.password },
        { headers: { "X-CSRF-TOKEN": 1 } },
      );
      // Two-factor required?
      if (res.data?.requires_2fa && res.data?.challenge) {
        setUsernameForDisplay(values.user);
        setChallenge(res.data.challenge);
        setStage("totp");
        setIsLoading(false);
        return;
      }
      await completeLogin();
    } catch (error) {
      handleAxiosError(error);
      setIsLoading(false);
    }
  };

  async function submit2FA(code: string) {
    setIsLoading(true);
    try {
      await axios.post(
        "/login/2fa",
        { challenge, code },
        { headers: { "X-CSRF-TOKEN": 1 } },
      );
      await completeLogin();
    } catch (error) {
      handleAxiosError(error);
      setIsLoading(false);
    }
  }

  return (
    <div className={cn("grid gap-4", className)} {...props}>
      {stage === "credentials" && (
        <Form {...credForm}>
          <form
            onSubmit={credForm.handleSubmit(onCredSubmit)}
            className="space-y-4"
          >
            <FormField
              name="user"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("form.user")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      className="h-10 border-input bg-background"
                      autoFocus
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck="false"
                      placeholder="admin"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("form.password")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      className="h-10 border-input bg-background"
                      type="password"
                      placeholder="••••••••••••"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <Button
              variant="select"
              disabled={isLoading}
              className="h-10 w-full font-medium"
              aria-label={t("form.login")}
            >
              {isLoading ? (
                <>
                  <ActivityIndicator className="mr-2 h-4 w-4" />
                  Signing in…
                </>
              ) : (
                <>
                  <MdLockOutline className="mr-2 size-4" />
                  Sign in
                </>
              )}
            </Button>
          </form>
        </Form>
      )}

      {stage === "totp" && (
        <TotpStep
          username={usernameForDisplay}
          isLoading={isLoading}
          onSubmit={submit2FA}
          onUseRecovery={() => setStage("recovery")}
          onBack={() => {
            setStage("credentials");
            setChallenge("");
          }}
        />
      )}

      {stage === "recovery" && (
        <RecoveryStep
          username={usernameForDisplay}
          isLoading={isLoading}
          onSubmit={submit2FA}
          onBack={() => setStage("totp")}
        />
      )}

      {stage === "credentials" && showFirstTimeLink && (
        <Card className="mt-2 border-amber-500/20 bg-amber-500/5 p-3 text-center text-xs">
          <CardContent className="p-1">
            <p className="mb-2 font-medium text-amber-300">
              {t("form.firstTimeLogin")}
            </p>
            <a
              href={getLocaleDocUrl("configuration/authentication#onboarding")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-amber-400 underline-offset-2 hover:underline"
            >
              {t("readTheDocumentation", { ns: "common" })}
              <LuExternalLink className="ml-1.5 size-3" />
            </a>
          </CardContent>
        </Card>
      )}
      <Toaster />
    </div>
  );
}

// ── 2FA TOTP step ────────────────────────────────────────────────────────────

function TotpStep({
  username,
  isLoading,
  onSubmit,
  onUseRecovery,
  onBack,
}: {
  username: string;
  isLoading: boolean;
  onSubmit: (code: string) => void;
  onUseRecovery: () => void;
  onBack: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // auto-focus first digit
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  function setDigit(i: number, v: string) {
    const sanitized = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = sanitized;
    setDigits(next);
    if (sanitized && i < 5) refs.current[i + 1]?.focus();
    if (sanitized && i === 5 && next.every((d) => d)) {
      onSubmit(next.join(""));
    }
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < 5) {
      refs.current[i + 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setDigits(text.split(""));
      onSubmit(text);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <LuShield className="size-6 text-primary" />
        </div>
      </div>
      <div className="space-y-1 text-center">
        <h2 className="text-base font-semibold">Two-factor authentication</h2>
        <p className="text-xs text-muted-foreground">
          Enter the 6-digit code from your authenticator app for{" "}
          <span className="font-medium text-foreground">{username}</span>.
        </p>
      </div>

      <div className="flex justify-center gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            className={cn(
              "h-12 w-10 rounded-md border-2 bg-background text-center font-mono text-xl font-semibold tabular-nums shadow-sm transition-all",
              d
                ? "border-primary text-foreground"
                : "border-input text-muted-foreground",
              "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
            )}
            disabled={isLoading}
          />
        ))}
      </div>

      <Button
        variant="select"
        className="h-10 w-full font-medium"
        disabled={isLoading || digits.some((d) => !d)}
        onClick={() => onSubmit(digits.join(""))}
      >
        {isLoading ? (
          <>
            <ActivityIndicator className="mr-2 h-4 w-4" />
            Verifying…
          </>
        ) : (
          "Verify and sign in"
        )}
      </Button>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <MdArrowBack className="size-3.5" /> Back
        </button>
        <button
          type="button"
          onClick={onUseRecovery}
          className="text-primary hover:underline"
        >
          Use a recovery code
        </button>
      </div>
    </div>
  );
}

// ── Recovery code step ───────────────────────────────────────────────────────

function RecoveryStep({
  username,
  isLoading,
  onSubmit,
  onBack,
}: {
  username: string;
  isLoading: boolean;
  onSubmit: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");

  function format(raw: string) {
    const clean = raw
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 12);
    return clean.replace(/^(.{4})(.{0,4})(.{0,4}).*/, (_m, a, b, c) =>
      [a, b, c].filter(Boolean).join("-"),
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/10">
          <LuShield className="size-6 text-amber-500" />
        </div>
      </div>
      <div className="space-y-1 text-center">
        <h2 className="text-base font-semibold">Use a recovery code</h2>
        <p className="text-xs text-muted-foreground">
          Enter one of the one-time recovery codes you saved when enabling 2FA
          for <span className="font-medium text-foreground">{username}</span>.
        </p>
      </div>

      <Input
        autoFocus
        spellCheck={false}
        autoCapitalize="characters"
        placeholder="XXXX-XXXX-XXXX"
        value={code}
        onChange={(e) => setCode(format(e.target.value))}
        className="h-12 text-center font-mono text-lg tracking-widest"
        disabled={isLoading}
      />

      <Button
        variant="select"
        className="h-10 w-full font-medium"
        disabled={isLoading || code.length < 14}
        onClick={() => onSubmit(code)}
      >
        {isLoading ? (
          <>
            <ActivityIndicator className="mr-2 h-4 w-4" />
            Verifying…
          </>
        ) : (
          "Sign in with recovery code"
        )}
      </Button>

      <p className="text-center text-[11px] text-muted-foreground">
        Each code can only be used once.
      </p>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <MdArrowBack className="size-3.5" /> Back to authenticator code
      </button>
    </div>
  );
}
