"use client";

import { BellIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDecimal } from "@/lib/decimal";
import { pendingCloseRequestsAction } from "@/modules/production-reporting/actions";
import type { PendingCloseRequest } from "@/modules/production-reporting/queries";

const POLL_MS = 30_000;

/**
 * Notification bell for approvers: requests to close an order with a
 * shortage. Refreshed every 30 s, on navigation and when the window gets
 * focus; a new request also shows a toast with a link to the order.
 */
export function CloseRequestBell({ initial }: { initial: PendingCloseRequest[] }) {
  const t = useTranslations("notifications");
  const tUnits = useTranslations("productUnits");
  const pathname = usePathname();
  const router = useRouter();
  const [requests, setRequests] = useState(initial);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    const announce = (list: PendingCloseRequest[]) => {
      const known = seen.current ?? new Set<string>();
      for (const request of list) {
        if (known.has(request.requestId)) continue;
        toast.warning(t("newToast", { number: request.orderNumber }), {
          id: request.requestId,
          action: {
            label: t("open"),
            onClick: () => router.push(`/orders/${request.orderId}?tab=production`),
          },
        });
      }
      seen.current = new Set(list.map((request) => request.requestId));
    };
    const refresh = async () => {
      try {
        const list = await pendingCloseRequestsAction();
        if (!active) return;
        setRequests(list);
        announce(list);
      } catch {
        // Offline or signed out: keep the last list; the next poll retries.
      }
    };
    if (seen.current === null) announce(initial);
    void refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname, initial, router, t]);

  const count = requests.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={count > 0 ? `${t("label")}: ${count}` : t("label")}
            data-testid="notification-bell"
          />
        }
      >
        <BellIcon />
        {count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white tabular-nums">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("closeTitle")}</DropdownMenuLabel>
          {count === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            requests.map((request) => (
              <DropdownMenuItem
                key={request.requestId}
                render={<Link href={`/orders/${request.orderId}?tab=production`} />}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">
                  {t("closeItem", {
                    number: request.orderNumber,
                    good: formatDecimal(request.good),
                    quantity: formatDecimal(request.quantity),
                    unit: tUnits(request.unit),
                  })}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {t("closeBy", { name: request.requestedBy ?? "—", reason: request.reason })}
                </span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
