import { UserAuthForm } from "@/components/auth/AuthForm";
import { ThemeProvider } from "@/context/theme-provider";
import "@/utils/i18n";
import { LanguageProvider } from "@/context/language-provider";

function LoginPage() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="frigate-ui-theme">
      <LanguageProvider>
        <div className="relative min-h-dvh w-full overflow-hidden bg-background">
          {/* Animated background gradient */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -left-32 -top-32 size-[480px] rounded-full bg-blue-500/10 blur-3xl" />
            <div className="absolute -bottom-32 -right-32 size-[480px] rounded-full bg-purple-500/10 blur-3xl" />
            <div className="absolute left-1/2 top-1/2 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/5 blur-3xl" />
          </div>

          <div className="flex min-h-dvh items-center justify-center p-6">
            <div className="w-full max-w-sm space-y-8">
              {/* Brand */}
              <div className="flex flex-col items-center gap-3">
                <ArgusLogo className="size-12" />
                <div className="text-center">
                  <h1 className="text-3xl font-bold tracking-tight text-foreground">
                    Argus
                  </h1>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The watchman that never sleeps
                  </p>
                </div>
              </div>

              {/* Card */}
              <div className="rounded-xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur">
                <UserAuthForm />
              </div>

              {/* Footer */}
              <p className="text-center text-[11px] text-muted-foreground">
                Protected by end-to-end TLS · 2FA enforced for admin accounts
              </p>
            </div>
          </div>
        </div>
      </LanguageProvider>
    </ThemeProvider>
  );
}

function ArgusLogo({ className = "" }: { className?: string }) {
  // Stylized "eye" — radial gradient iris over a dark sclera
  return (
    <svg viewBox="0 0 64 64" className={className}>
      <defs>
        <radialGradient id="iris" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </radialGradient>
        <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      {/* Outer ring */}
      <circle
        cx="32"
        cy="32"
        r="28"
        fill="none"
        stroke="url(#ring)"
        strokeWidth="3"
      />
      {/* Iris */}
      <circle cx="32" cy="32" r="14" fill="url(#iris)" />
      {/* Pupil */}
      <circle cx="32" cy="32" r="5" fill="#0a0f1a" />
      {/* Highlight */}
      <circle cx="28" cy="28" r="2" fill="#ffffff" opacity="0.9" />
      {/* Subtle eyelash dots — the 100 eyes motif, abstracted */}
      {[0, 60, 120, 180, 240, 300].map((deg) => {
        const r = 24;
        const x = 32 + r * Math.cos((deg * Math.PI) / 180);
        const y = 32 + r * Math.sin((deg * Math.PI) / 180);
        return <circle key={deg} cx={x} cy={y} r="1.5" fill="#22d3ee" />;
      })}
    </svg>
  );
}

export default LoginPage;
