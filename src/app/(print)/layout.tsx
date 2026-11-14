import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/components/shared/scoped-intl-provider";

// Printable pages (A4): no app chrome, always light, black on white.
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <ScopedIntlProvider>
      <div className="flex min-h-full flex-1 flex-col bg-white text-black">{children}</div>
    </ScopedIntlProvider>
  );
}
