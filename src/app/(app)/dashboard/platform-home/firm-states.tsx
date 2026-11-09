import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { stateSlices, type PlatformHome } from "@/modules/platform/home";

// Same hues as the StatusBadge dots: state colors are reserved, never reused as series.
const STROKE: Record<string, string> = {
  active: "stroke-emerald-500",
  trial: "stroke-sky-500",
  warning: "stroke-amber-500",
  overdue: "stroke-red-500",
  locked: "stroke-red-900 dark:stroke-red-300",
};
const DOT: Record<string, string> = {
  active: "bg-emerald-500",
  trial: "bg-sky-500",
  warning: "bg-amber-500",
  overdue: "bg-red-500",
  locked: "bg-red-900 dark:bg-red-300",
};

const R = 40;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 2; // gap between slices, in circumference units

export function FirmStates({ firms }: { firms: PlatformHome["firms"] }) {
  const t = useTranslations("platformHome.states");
  const ts = useTranslations("platform.billing.states");
  const slices = stateSlices(firms);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const summary = slices.map((slice) => `${ts(slice.key)} ${slice.value}`).join(", ");

  const arcs = slices.map((slice, index) => {
    const before = slices.slice(0, index).reduce((sum, s) => sum + s.value, 0);
    const length = (slice.value / total) * CIRCUMFERENCE;
    return {
      slice,
      offset: (before / total) * CIRCUMFERENCE,
      dash: slices.length > 1 ? Math.max(length - GAP, 0.5) : length,
    };
  });

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-6">
            <div className="relative size-32 shrink-0">
              <svg
                viewBox="0 0 100 100"
                role="img"
                aria-label={t("alt", { summary })}
                className="size-full -rotate-90"
              >
                {arcs.map(({ slice, offset, dash }) => (
                  <circle
                    key={slice.key}
                    cx="50"
                    cy="50"
                    r={R}
                    fill="none"
                    strokeWidth="12"
                    className={STROKE[slice.key]}
                    strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                    strokeDashoffset={-offset}
                  >
                    <title>{`${ts(slice.key)}: ${slice.value}`}</title>
                  </circle>
                ))}
              </svg>
              <div
                aria-hidden
                className="absolute inset-0 flex flex-col items-center justify-center"
              >
                <span className="text-xl font-semibold tabular-nums">{total}</span>
                <span className="text-xs text-muted-foreground">{t("total")}</span>
              </div>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {slices.map((slice) => (
                <li key={slice.key} className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-2 rounded-full", DOT[slice.key])} />
                  <span>{ts(slice.key)}</span>
                  <span className="ml-auto pl-4 font-medium tabular-nums">{slice.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
