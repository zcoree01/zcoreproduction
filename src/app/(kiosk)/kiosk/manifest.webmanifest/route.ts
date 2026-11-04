import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

// Web app manifest of the attendance kiosk (D-048): Chrome on Android offers
// "Install app"; the installed kiosk opens full screen on /kiosk of the host
// it was installed from (kiosk.zcore.ba in production).
export async function GET() {
  const t = await getTranslations("kiosk");
  const manifest: MetadataRoute.Manifest = {
    id: "/kiosk",
    name: t("appName"),
    short_name: t("appName"),
    description: t("appDescription"),
    start_url: "/kiosk",
    scope: "/kiosk",
    display: "fullscreen",
    orientation: "any",
    background_color: "#171717",
    theme_color: "#171717",
    icons: [
      { src: "/kiosk/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/kiosk/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/kiosk/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
