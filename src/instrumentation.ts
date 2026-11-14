import { registerOTel } from "@vercel/otel";

// OpenTelemetry traces (Next.js spans: requests, rendering, fetch). On Vercel
// they appear in Observability → Traces, so slow requests can be traced to the
// step that is slow. No exporter configured locally: spans are dropped.
export function register() {
  registerOTel({ serviceName: "zcore-production" });
}
