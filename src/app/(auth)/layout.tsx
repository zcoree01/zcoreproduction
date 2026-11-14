import type { ReactNode } from "react";
import { ScopedIntlProvider } from "@/components/shared/scoped-intl-provider";

// Sign-in, registration, password change: only their own messages.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <ScopedIntlProvider scope="auth">{children}</ScopedIntlProvider>;
}
