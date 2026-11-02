"use client";

import { useEffect } from "react";

/** Opens the print dialog once the page is shown ("Izdaj i štampaj"). */
export function AutoPrint() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
