import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// The dev server only serves its scripts to allowed origins. Allow this
// computer's local-network addresses, so a phone or the kiosk tablet can open
// http://<computer IP>:3000/...?org=<slug> during development.
const localNetworkHosts = Object.values(networkInterfaces())
  .flat()
  .flatMap((entry) => (entry && entry.family === "IPv4" && !entry.internal ? [entry.address] : []));

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // The e2e dev server (playwright.config.ts) runs without the Turbopack
    // disk cache: it grew by several GB per full run and filled the C: disk.
    turbopackFileSystemCacheForDev: process.env.ZCORE_DEV_FS_CACHE !== "off",
  },
  partialPrefetching: true,
  allowedDevOrigins: localNetworkHosts,
  // Delivery note PDFs (D-040): react-pdf runs as a plain Node package, and
  // its fonts are read from disk, so they must ship with the function.
  serverExternalPackages: ["@react-pdf/renderer"],
  // No framing by other sites (clickjacking), no MIME sniffing, no full URLs
  // in referrers; camera (QR / kiosk) and NFC only for the app itself.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(), nfc=(self)",
          },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/inventory/delivery-notes/[id]/pdf": ["./src/assets/fonts/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
