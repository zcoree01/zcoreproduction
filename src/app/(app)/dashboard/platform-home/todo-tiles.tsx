import {
  GaugeIcon,
  HourglassIcon,
  InboxIcon,
  LifeBuoyIcon,
  MessageSquareWarningIcon,
  OctagonAlertIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PlatformHome } from "@/modules/platform/home";

type Tile = {
  key:
    | "directoryRequests"
    | "supportPending"
    | "trialsEnding"
    | "deletionsScheduled"
    | "problemReports"
    | "slowOpen"
    | "purgeFailed";
  icon: ComponentType<{ className?: string }>;
  href: string;
  value: number;
  /** Shown first and in the destructive colour. */
  alert?: boolean;
};

export function TodoTiles({
  todo,
  purgeFailures,
}: {
  todo: PlatformHome["todo"];
  /** Firms whose permanent deletion failed (D-055): a tile only when there are any. */
  purgeFailures: number;
}) {
  const t = useTranslations("platformHome.todo");
  const failed: Tile[] =
    purgeFailures > 0
      ? [
          {
            key: "purgeFailed",
            icon: OctagonAlertIcon,
            href: "/platform?filter=purge_failed",
            value: purgeFailures,
            alert: true,
          },
        ]
      : [];
  const tiles: Tile[] = [
    ...failed,
    {
      key: "directoryRequests",
      icon: InboxIcon,
      href: "/platform/requests",
      value: todo.directory_requests,
    },
    {
      key: "problemReports",
      icon: MessageSquareWarningIcon,
      href: "/platform/reports",
      value: todo.problem_reports_open,
    },
    {
      key: "slowOpen",
      icon: GaugeIcon,
      href: "/platform/reports?category=slow",
      value: todo.slow_open,
    },
    {
      key: "supportPending",
      icon: LifeBuoyIcon,
      href: "/platform/reports?tab=support",
      value: todo.support_pending,
    },
    {
      key: "trialsEnding",
      icon: HourglassIcon,
      href: "/platform?filter=trial",
      value: todo.trials_ending,
    },
    {
      key: "deletionsScheduled",
      icon: Trash2Icon,
      href: "/platform?filter=archived",
      value: todo.deletions_scheduled,
    },
  ];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ key, icon: Icon, href, value, alert }) => (
          <Link
            key={key}
            href={href}
            data-testid={`todo-${key}`}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
              alert && "border-destructive/50 bg-destructive/5 text-destructive",
            )}
          >
            <span
              className={cn(
                "flex items-center gap-2 text-sm",
                alert ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {t(key)}
            </span>
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
            <span className="text-xs text-muted-foreground">{t("open")} →</span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
