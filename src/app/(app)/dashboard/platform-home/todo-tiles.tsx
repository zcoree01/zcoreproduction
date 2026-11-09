import { HourglassIcon, InboxIcon, LifeBuoyIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlatformHome } from "@/modules/platform/home";

type Tile = {
  key: "directoryRequests" | "supportPending" | "trialsEnding" | "deletionsScheduled";
  icon: ComponentType<{ className?: string }>;
  href: string;
  value: number;
};

export function TodoTiles({ todo }: { todo: PlatformHome["todo"] }) {
  const t = useTranslations("platformHome.todo");
  const tiles: Tile[] = [
    {
      key: "directoryRequests",
      icon: InboxIcon,
      href: "/platform/requests",
      value: todo.directory_requests,
    },
    { key: "supportPending", icon: LifeBuoyIcon, href: "/platform", value: todo.support_pending },
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
        {tiles.map(({ key, icon: Icon, href, value }) => (
          <Link
            key={key}
            href={href}
            className="flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
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
