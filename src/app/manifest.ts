import type { MetadataRoute } from "next";

/**
 * PWA manifest — what makes the app installable on Android, iOS (via Add to
 * Home Screen) and desktop Chrome / Edge as a standalone window. Icons here
 * line up with the generated routes from icon.tsx / icon0.tsx / icon1.tsx.
 *
 * Updating any of these fields invalidates the cached manifest in browsers
 * that have already installed the app — they keep the old metadata until
 * the user re-installs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SWISH COMPLIANCE SYSTEM V2.",
    short_name: "SWISH COMPLIANCE",
    description:
      "SOP register, audits, CAPA tracking and compliance dashboards for Swish.",
    start_url: "/my-work",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0d4530",
    theme_color: "#047857",
    lang: "en",
    icons: [
      // 32×32 favicon (also handy in shortcut menus)
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      // 192×192 — the home-screen icon on Android
      {
        src: "/icon0",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      // 192×192 — masked variant for adaptive icons
      {
        src: "/icon0",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      // 512×512 — splash screen + larger launchers
      {
        src: "/icon1",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["business", "productivity"],
  };
}
