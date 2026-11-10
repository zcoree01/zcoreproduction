"use client";

import { InboxIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { listMyProblemReportsAction } from "@/modules/support/problem-reports/actions";
import type { ProblemStatus } from "@/modules/support/problem-reports/schemas";
import type { MyProblemReport } from "@/modules/support/problem-reports/types";
import { ReportThread } from "./report-thread";

const TONES: Record<ProblemStatus, StatusTone> = {
  new: "info",
  in_progress: "warning",
  waiting_user: "danger",
  resolved: "success",
};

/** "Moje prijave": the caller's own reports; a click opens the conversation. */
export function MyReports({
  refreshKey,
  onOpened,
  onChanged,
}: {
  /** Changes when a report was sent or a notice arrived: the list reloads. */
  refreshKey: number;
  onOpened: (reportId: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations("problemReports");
  const format = useFormatter();
  const [reports, setReports] = useState<MyProblemReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // refreshKey is the trigger: a report was sent, answered, or a notice arrived.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const list = await listMyProblemReportsAction();
        if (!active) return;
        setReports(list);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const selected = reports?.find((report) => report.id === selectedId) ?? null;
  if (selected) {
    return (
      <ReportThread
        report={selected}
        onBack={() => setSelectedId(null)}
        onOpened={onOpened}
        onChanged={onChanged}
      />
    );
  }

  if (failed && reports === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-destructive">{t("errors.load")}</p>
        <Button type="button" variant="outline" onClick={onChanged}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (reports === null) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <InboxIcon className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t("emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {reports.map((report) => (
        <li key={report.id}>
          <button
            type="button"
            data-testid="my-report"
            className="flex min-h-14 w-full flex-col gap-1 rounded-lg border p-3 text-left hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setSelectedId(report.id)}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t(`categories.${report.category}`)}</span>
              <StatusBadge tone={TONES[report.status]}>
                {t(`statuses.${report.status}`)}
              </StatusBadge>
              <span className="ml-auto text-xs text-muted-foreground">
                {format.dateTime(new Date(report.createdAt), { dateStyle: "medium" })}
              </span>
            </span>
            {report.description ? (
              <span className="line-clamp-2 text-sm text-muted-foreground">
                {report.description}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
