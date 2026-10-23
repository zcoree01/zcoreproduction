import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "./page-skeleton";

// Boundary for page content that reads the session (required with Cache
// Components: request data must be read inside <Suspense>).
export function PageSuspense({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

async function PageFallback() {
  const t = await getTranslations("common");
  return <PageSkeleton label={t("loading")} />;
}
