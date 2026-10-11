import LoginForm from "./LoginForm";

/**
 * Reasons the SWiSH World single sign-on handoff (/api/sso/handoff) sends
 * people back here with, so the page can say why instead of showing a bare
 * login form.
 */
const SSO_MESSAGES: Record<string, (email: string) => string> = {
  "no-user": (email) =>
    `SWiSH World signed you in as ${email || "your SWiSH World account"}, but Compliance has no user with that e-mail. Ask IT to create your Compliance account with the same e-mail, then open Compliance from SWiSH World again.`,
  disabled: (email) =>
    `Your Compliance account${email ? ` (${email})` : ""} is deactivated. Ask IT to re-enable it.`,
  ambiguous: (email) =>
    `More than one Compliance account uses ${email || "this e-mail"}. Ask IT to remove the duplicate before signing in through SWiSH World.`,
  "mapping-refused": () =>
    "The Compliance account linked to you in SWiSH World cannot be used for single sign-on (its e-mail differs from yours or it is an administrator account). Sign in with your password or ask IT to correct the identity mapping.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const ssoReason = typeof params.sso === "string" ? params.sso : "";
  const ssoEmail = typeof params.email === "string" ? params.email.slice(0, 200) : "";
  const ssoMessage = ssoReason ? SSO_MESSAGES[ssoReason]?.(ssoEmail) : undefined;

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white">
      {/* ───────────────────────── LEFT PANEL ───────────────────────── */}
      <section className="relative overflow-hidden bg-[#080d0a] text-white px-8 py-10 md:px-14 md:py-14 flex flex-col justify-between min-h-[60vh] lg:min-h-screen">
        {/* Subtle radial glow */}
        <div className="absolute -top-32 -left-32 w-[26rem] h-[26rem] rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-20 w-[28rem] h-[28rem] rounded-full bg-emerald-700/10 blur-3xl pointer-events-none" />

        {/* Brand mark */}
        <div className="relative flex items-center gap-3 z-10">
          <div className="w-12 h-12 rounded-xl bg-white text-[#080d0a] flex items-center justify-center shadow-lg ring-1 ring-white/10">
            {/* Shield icon */}
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-black tracking-[0.18em] uppercase">
              SWISH <span className="text-white/55 font-bold">COMPLIANCE</span>
            </div>
            <div className="text-[10px] tracking-[0.32em] text-white/40 uppercase mt-0.5">
              Audit Infrastructure
            </div>
          </div>
        </div>

        {/* Hero */}
        <div className="relative z-10 py-10 md:py-0">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight">
            SWISH
            <br />
            COMPLIANCE
            <br />
            <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent italic">
              SYSTEM.
            </span>
          </h1>
          <p className="text-base text-white/60 mt-7 max-w-md leading-relaxed">
            The next evolution in compliance &amp; audit engineering. Intelligent SOP governance and real-time risk monitoring for the entire group.
          </p>
        </div>

        {/* Feature strip */}
        <div className="relative z-10 space-y-3.5 md:space-y-4">
          <FeatureRow
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            }
            label="High-precision SOP & audit governance"
          />
          <FeatureRow
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            }
            label="Real-time compliance performance analytics"
          />
          <FeatureRow
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            }
            label="ISO, HACCP & global quality standards compliance"
          />
        </div>
      </section>

      {/* ───────────────────────── RIGHT PANEL ───────────────────────── */}
      <section className="relative flex items-center justify-center px-6 py-12 md:px-12 lg:px-16">
        <div className="w-full max-w-md">
          {/* Pill: identity hint */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-7 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold tracking-[0.18em] uppercase">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 11h.01" />
              <path d="M12 5a7 7 0 0 0-7 7c0 5 4 7 7 7s7-2 7-7a7 7 0 0 0-7-7Z" />
              <path d="M12 5v3" />
            </svg>
            Secure Identity Bridge
          </div>

          <h2 className="text-5xl md:text-6xl font-black leading-[0.95] tracking-tight text-gray-900">
            OPERATOR
            <br />
            <span className="italic bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">
              VERIFICATION
            </span>
          </h2>
          <p className="text-xs md:text-sm text-gray-500 tracking-[0.16em] uppercase mt-4 font-medium">
            Establish secure connection to the compliance mainframe
          </p>

          {ssoMessage && (
            <div
              role="status"
              className="mt-8 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"
            >
              {ssoMessage}
            </div>
          )}

          <div className="mt-10">
            <LoginForm />
          </div>

          <p className="text-[10px] tracking-[0.22em] text-gray-400 text-center mt-10 uppercase">
            Swish Compliance ECS · Internal use only
          </p>
        </div>
      </section>
    </main>
  );
}

function FeatureRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/70">
        {icon}
      </span>
      <span className="text-[11px] tracking-[0.22em] uppercase text-white/65 font-semibold">
        {label}
      </span>
    </div>
  );
}
