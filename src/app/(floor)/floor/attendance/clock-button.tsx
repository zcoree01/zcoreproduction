"use client";

import { LogInIcon, LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clockAction } from "@/modules/attendance/actions";

/**
 * One big button: clock in or clock out. The idempotency key is kept until
 * the server confirms, so a double tap or a resend after a lost connection
 * never records twice.
 */
export function ClockButton({ direction }: { direction: "in" | "out" }) {
  const t = useTranslations("attendance");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const send = () =>
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof clockAction>>;
      try {
        result = await clockAction({ direction, idempotencyKey });
      } catch {
        toast.error(t("errors.offline"));
        return;
      }
      if (result.ok) {
        toast.success(t(direction === "in" ? "inToast" : "outToast"));
        setIdempotencyKey(crypto.randomUUID());
        router.refresh();
        return;
      }
      toast.error(t(`errors.${result.error}`));
      if (result.error === "already_clocked_in" || result.error === "not_clocked_in") {
        setIdempotencyKey(crypto.randomUUID());
        router.refresh();
      }
    });

  return (
    <Button
      size="lg"
      variant={direction === "in" ? "default" : "destructive"}
      className="h-20 w-full text-xl"
      disabled={pending}
      onClick={send}
    >
      {direction === "in" ? <LogInIcon className="size-6" /> : <LogOutIcon className="size-6" />}
      {pending ? t("sending") : direction === "in" ? t("clockIn") : t("clockOut")}
    </Button>
  );
}
