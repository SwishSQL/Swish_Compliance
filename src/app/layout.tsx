import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SWISH COMPLIANCE SYSTEM V2.",
    template: "%s — SWISH COMPLIANCE SYSTEM V2.",
  },
  description:
    "SOP register, audits, CAPA tracking and compliance dashboards for Swish.",
  applicationName: "SWISH COMPLIANCE SYSTEM V2.",
  appleWebApp: {
    capable: true,
    title: "SWISH COMPLIANCE SYSTEM V2.",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  // Next.js will also auto-inject the generated icon.tsx / apple-icon.tsx
  // routes. Keeping the SVG declaration here as a fallback for browsers
  // that prefer SVG favicons.
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
};

/**
 * Viewport — separate export in Next.js 15. `viewportFit: cover` so the app
 * extends under iPhone notches when installed as a PWA; safe-area insets
 * are handled in CSS. `themeColor` paints the mobile address bar to match
 * the dark sidebar.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#047857" },
    { media: "(prefers-color-scheme: dark)", color: "#0d4530" },
  ],
};

/**
 * Inline script that runs BEFORE React hydrates. Reads the user's
 * saved theme (or falls back to OS preference) and applies the `dark`
 * class to <html> immediately, so the page doesn't flash light-then-
 * dark on every navigation.
 *
 * Kept short and dependency-free so it's safe to inline.
 */
const noFlashThemeScript = `
(function() {
  try {
    var saved = localStorage.getItem('swish:theme');
    var isDark =
      saved === 'dark' ||
      (saved !== 'light' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: noFlashThemeScript }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
