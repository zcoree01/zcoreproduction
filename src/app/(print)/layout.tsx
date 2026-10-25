import type { ReactNode } from "react";

// Printable pages (A4): no app chrome, always light, black on white.
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col bg-white text-black">{children}</div>;
}
