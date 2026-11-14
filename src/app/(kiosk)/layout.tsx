import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/components/shared/scoped-intl-provider";

// Kiosk tablet: only its own messages.
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="kiosk">{children}</ScopedIntlProvider>;
}
