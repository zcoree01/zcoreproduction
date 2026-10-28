"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prints the current page (print layouts). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()}>
      <PrinterIcon />
      {label}
    </Button>
  );
}
