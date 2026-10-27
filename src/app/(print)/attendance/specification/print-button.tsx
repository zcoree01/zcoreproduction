"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SpecificationPrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()}>
      <PrinterIcon />
      {label}
    </Button>
  );
}
