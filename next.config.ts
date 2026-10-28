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
  partialPrefetching: true,
  allowedDevOrigins: localNetworkHosts,
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
