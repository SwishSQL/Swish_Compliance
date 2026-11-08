"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";

/* ─── Icon library (Lucide-style, inline) ──────────────────────────── */

type IconKey =
  | "my-work" | "roadmap" | "tests" | "reports"
  | "sops" | "checklists" | "questions" | "audits" | "capa"
  | "domains" | "frameworks" | "controls" | "policies"
  | "admin-home" | "users" | "brands" | "departments" | "org-units" | "config" | "audit-logs" | "import"
  | "logout" | "chevron-right" | "menu" | "close";

const ICON_PATHS: Record<IconKey, React.ReactNode> = {
  "my-work": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
      <path d="m9 16 2 2 4-4" />
    </>
  ),
  roadmap: (
    <>
      <path d="M9 18l-6 3V8l6-3M9 18V5M9 18l6 3M9 5l6 3M15 21V8M15 21l6-3V5l-6 3" />
    </>
  ),
  tests: (
    <>
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  reports: (
    <>
      <line x1="3" y1="3" x2="3" y2="21" />
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="6" y="13" width="3" height="5" />
      <rect x="11" y="9" width="3" height="9" />
      <rect x="16" y="5" width="3" height="13" />
    </>
  ),
  sops: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </>
  ),
  checklists: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M9 2v4M15 2v4" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  audits: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  questions: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 2-3 4" />
      <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
    </>
  ),
  capa: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </>
  ),
  domains: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  frameworks: (
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>
  ),
  controls: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  policies: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  "admin-home": (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  brands: (
    <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  departments: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </>
  ),
  "org-units": (
    <>
      <circle cx="12" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M12 7v6m0 0H6v4m6-4h6v4" />
    </>
  ),
  config: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  "audit-logs": (
    <>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      <polyline points="12 7 12 12 16 14" />
    </>
  ),
  import: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  "chevron-right": (
    <polyline points="9 18 15 12 9 6" />
  ),
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
};

function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconKey;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ─── Navigation data ──────────────────────────────────────────────── */

type NavItem = { href: string; label: string; icon: IconKey; indicator?: boolean };
type Section = { label: string; items: NavItem[] };

const WORKSPACE: Section = {
  label: "Workspace",
  items: [
    { href: "/my-work", label: "My Work", icon: "my-work", indicator: true },
    { href: "/roadmap", label: "Roadmap", icon: "roadmap" },
    { href: "/reports", label: "Reports", icon: "reports" },
  ],
};

// Navigation mirrors the GRC lifecycle (user spec 2026-08-17):
//   Compliance Library — master data, "what we must comply with",
//     ordered as the hierarchy itself: SOP -> Domain -> Framework ->
//     Control -> Test -> Checklist -> Question.
//   Assurance — execution & monitoring: Audits, Corrective Actions.
// Previously both lived in one "Compliance" section; splitting them
// matches the two-part structure the rest of the org already thinks in.
const COMPLIANCE_LIBRARY: Section = {
  label: "Compliance Library",
  items: [
    { href: "/sops", label: "SOPs & Policies", icon: "sops" },
    { href: "/domains", label: "Domains", icon: "domains" },
    { href: "/frameworks", label: "Frameworks", icon: "frameworks" },
    { href: "/controls", label: "Controls", icon: "controls" },
    { href: "/tests", label: "Tests", icon: "tests" },
    { href: "/checklists/templates", label: "Checklists", icon: "checklists" },
    { href: "/questions", label: "Questions", icon: "questions" },
  ],
};

const ASSURANCE: Section = {
  label: "Assurance",
  items: [
    { href: "/audits", label: "Audits", icon: "audits" },
    { href: "/capa", label: "Corrective Actions", icon: "capa" },
  ],
};

const ADMINISTRATION: Section = {
  label: "Administration",
  items: [
    { href: "/admin", label: "Admin Home", icon: "admin-home" },
    { href: "/admin/import", label: "Import Data", icon: "import" },
    // Users, Brands, Departments and Org Units are tabs on this one page
    // now (user spec 2026-08-17) — no separate nav entries for each.
    { href: "/admin/config", label: "Config", icon: "config" },
    { href: "/admin/audit-logs", label: "Audit Logs", icon: "audit-logs" },
  ],
};

/* ─── Helpers ──────────────────────────────────────────────────────── */

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0].length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

function sectionHasActiveItem(pathname: string, section: Section): boolean {
  return section.items.some((it) => isItemActive(pathname, it.href));
}

function sectionHasIndicator(section: Section): boolean {
  return section.items.some((it) => it.indicator);
}

const LS_KEY = "swish:sidebar:open";
const LS_COLLAPSE_KEY = "swish:sidebar:collapsed";

/* ─── Collapsible section ──────────────────────────────────────────── */

function CollapsibleSection({
  section,
  isOpen,
  onToggle,
  pathname,
}: {
  section: Section;
  isOpen: boolean;
  onToggle: () => void;
  pathname: string;
}) {
  const showIndicator = sectionHasIndicator(section);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full group flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] uppercase tracking-[0.18em] text-white/70 hover:text-white font-semibold transition-colors"
      >
        <span className="flex items-center gap-2">
          {section.label}
          {showIndicator && !isOpen && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          )}
        </span>
        <Icon
          name="chevron-right"
          size={12}
          className={`transition-transform duration-200 ${
            isOpen ? "rotate-90 text-white/80" : "text-white/50 group-hover:text-white/80"
          }`}
        />
      </button>

      {/* Smooth collapse using CSS grid 1fr / 0fr trick */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <ul className="space-y-0.5 mt-1 mb-1">
            {section.items.map((item) => {
              const active = isItemActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-all duration-150 ${
                      active
                        ? "bg-emerald-500/10 text-white font-medium"
                        : "text-white/85 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-emerald-400"
                        aria-hidden="true"
                      />
                    )}
                    <Icon
                      name={item.icon}
                      className={`shrink-0 transition-colors ${
                        active
                          ? "text-emerald-400"
                          : "text-white/65 group-hover:text-white"
                      }`}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.indicator && !active && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ─── Sidebar ──────────────────────────────────────────────────────── */

export default function Sidebar({
  displayName,
  role,
}: {
  displayName: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  /** Mobile drawer state. On desktop (md+) this is ignored — the sidebar
   *  is always visible via CSS. On mobile it controls the slide-in panel. */
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the mobile drawer whenever the route changes (the user
  // tapped a nav link). On desktop this is harmless — the state is unused.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open so the user doesn't scroll
  // the page behind it. Only matters on mobile.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  // Escape key closes the drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  let sections: Section[] = [WORKSPACE, COMPLIANCE_LIBRARY, ASSURANCE];
  if (role === "admin") sections.push(ADMINISTRATION);

  // Department managers get a trimmed nav (user spec): their workspace +
  // Corrective Actions only — no authoring/GRC sections.
  if (role === "department_manager") {
    sections = [
      WORKSPACE,
      {
        label: "Assurance",
        items: ASSURANCE.items.filter((it) => it.href === "/capa"),
      },
    ];
  }

  // Accordion: at most ONE section open at a time (user spec 2026-08-17—
  // opening a section like Workspace closes whichever other one was open).
  // Initialized null for SSR; the effect below opens the section that
  // contains the active page (or restores the user's last choice from
  // localStorage).
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    // The section holding the current page always wins — a stale
    // "last opened" section from localStorage shouldn't hide where the
    // user actually is.
    const active = sections.find((s) => sectionHasActiveItem(pathname, s));
    if (active) {
      setOpenSection(active.label);
      return;
    }
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored && sections.some((s) => s.label === stored)) {
        setOpenSection(stored);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggleSection(label: string) {
    setOpenSection((prev) => {
      const next = prev === label ? null : label;
      try {
        if (next) localStorage.setItem(LS_KEY, next);
        else localStorage.removeItem(LS_KEY);
      } catch {
        // ignore
      }
      return next;
    });
  }

  const anyOpen = openSection !== null;
  function collapseAll() {
    setOpenSection(null);
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }

  // Desktop collapse — hides the whole rail so the content spans full width.
  // Persisted, and mirrored onto <html data-sidebar-collapsed> so the CSS
  // rule in globals.css can drop the main column's left margin.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(LS_COLLAPSE_KEY) === "1";
    } catch {
      // ignore
    }
    setCollapsed(stored);
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute(
      "data-sidebar-collapsed",
      collapsed ? "1" : "0"
    );
  }, [collapsed]);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      {/* ─── Mobile top bar (hamburger + brand) ─────────────────────── */}
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 h-14 bg-[#0d3a2a] dark:bg-[#0a0a0a] border-b border-white/[0.06] text-white"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="p-2 -ml-2 rounded-lg text-gray-200 hover:bg-white/[0.08] active:bg-white/[0.12]"
        >
          <Icon name="menu" size={22} />
        </button>
        <Link href="/my-work" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center font-black text-white text-xs shadow ring-1 ring-white/10">
            S
          </div>
          <span className="text-sm font-bold tracking-tight">
            Swish
            <span className="text-emerald-400/70 ml-1 text-[10px] font-medium tracking-widest">
              v2
            </span>
          </span>
        </Link>
        {/* Compact theme toggle on the right so it's always reachable on mobile */}
        <ThemeToggle compact />
      </div>

      {/* ─── Mobile backdrop ────────────────────────────────────────── */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/55 backdrop-blur-sm animate-fade-in"
        />
      )}

      {/* ─── Desktop "show sidebar" tab — only when collapsed ───────── */}
      {collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Show navigation"
          className="hidden md:flex fixed top-3 left-0 z-50 items-center gap-1 pl-2 pr-3 py-2 rounded-r-lg bg-[#0d4530] dark:bg-[#141414] text-white shadow-lg hover:bg-[#10523a] border border-l-0 border-white/[0.08]"
        >
          <Icon name="menu" size={18} />
          <span className="text-[11px] font-medium">Menu</span>
        </button>
      )}

      {/* ─── Sidebar / drawer ───────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 md:w-64 flex flex-col bg-gradient-to-b from-[#10523a] via-[#0d4530] to-[#0a3826] dark:from-[#141414] dark:via-[#0d0d0d] dark:to-[#070707] border-r border-white/[0.06] transform transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:-translate-x-full" : "md:translate-x-0"}`}
        style={{
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.02)",
          paddingTop: "env(safe-area-inset-top)",
        }}
        aria-label="Primary navigation"
      >
        {/* Close button — mobile only, top-right of the drawer */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="md:hidden absolute top-3 right-3 p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/[0.10]"
        >
          <Icon name="close" size={18} />
        </button>
      {/* Brand header */}
      <div className="px-4 pt-5 pb-4">
        <Link href="/my-work" className="flex items-center gap-3 group">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center font-black text-white text-base shadow-lg shadow-emerald-900/40 ring-1 ring-white/10">
              S
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0d4530] dark:border-[#0a0a0a]" />
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.22em] font-semibold text-emerald-100">
              Swish
            </div>
            <div className="text-[13px] font-bold text-white leading-tight tracking-tight">
              Compliance
              <span className="text-emerald-400/70 ml-1.5 text-[10px] font-medium tracking-widest">
                v2
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* Divider + quick controls */}
      <div className="px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] uppercase tracking-[0.22em] text-white/55">
            Navigation
          </span>
          <div className="flex items-center gap-3">
            {/* Accordion mode: at most one section is ever open, so
                there's nothing to "expand all" — only collapse the one
                that's open, and only show the control when that's true. */}
            {anyOpen && (
              <button
                type="button"
                onClick={collapseAll}
                className="text-[10px] text-white/70 hover:text-white transition-colors uppercase tracking-wider"
                aria-label="Collapse section"
              >
                Collapse
              </button>
            )}
            {/* Desktop-only: hide the whole rail */}
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden md:inline-flex text-white/60 hover:text-white transition-colors"
              aria-label="Hide navigation"
              title="Hide sidebar"
            >
              «
            </button>
          </div>
        </div>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-3 pt-3 pb-4 sidebar-scroll">
        <div className="space-y-2">
          {sections.map((section) => (
            <CollapsibleSection
              key={section.label}
              section={section}
              isOpen={hasMounted ? openSection === section.label : sectionHasActiveItem(pathname, section)}
              onToggle={() => toggleSection(section.label)}
              pathname={pathname}
            />
          ))}
        </div>
      </nav>

      {/* User card + sign out */}
      <div className="p-3 border-t border-white/[0.06]">
        <Link
          href="/account"
          className="flex items-center gap-3 px-2 py-2 rounded-lg mb-2 hover:bg-white/[0.08] transition-colors"
        >
          <div className="relative shrink-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 flex items-center justify-center text-white text-xs font-bold ring-1 ring-white/10 shadow">
              {initialsFrom(displayName)}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0d4530] dark:border-[#0a0a0a]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-white truncate">
              {displayName}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-100 font-medium">
              {roleLabel(role)}
            </div>
          </div>
        </Link>

        {/* Theme toggle — segmented Light / System / Dark */}
        <div className="mb-2">
          <div className="text-[9px] uppercase tracking-[0.22em] text-white/55 mb-1.5 px-1">
            Appearance
          </div>
          <ThemeToggle />
        </div>

        <button
          onClick={signOut}
          disabled={signingOut}
          className="w-full flex items-center justify-center gap-2 bg-white/[0.08] hover:bg-white/[0.14] active:bg-white/[0.18] border border-white/[0.10] hover:border-white/[0.18] text-white hover:text-white py-2 rounded-lg text-[12px] font-medium transition-all duration-150 disabled:opacity-50"
        >
          <Icon name="logout" size={16} />
          {signingOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>

        <style>{`
          .sidebar-scroll::-webkit-scrollbar {
            width: 6px;
          }
          .sidebar-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .sidebar-scroll::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.06);
            border-radius: 3px;
          }
          .sidebar-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.12);
          }
          @keyframes fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          .animate-fade-in {
            animation: fade-in 150ms ease-out;
          }
        `}</style>
      </aside>
    </>
  );
}
