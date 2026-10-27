"use client";

import { SettingsIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDay } from "@/lib/format";
import { formatMoney } from "@/modules/attendance/month-rules";
import type { RateChange } from "@/modules/attendance/pay-rules";
import { saveWorkCalendarAction, setHourlyRateAction } from "@/modules/attendance/payroll-actions";
import type { IsoWeekday } from "@/modules/attendance/schedule-rules";

const WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * Per employee: own weekend days (turnus workers), the holidays they take
 * (holidays non-working for selected employees) and, with payroll.manage,
 * the net hourly rate history.
 */
export function EmployeeSettingsButton(props: {
  employeeId: string;
  employeeName: string;
  ownWeekend: boolean;
  weekendDays: IsoWeekday[];
  orgWeekendDays: IsoWeekday[];
  holidayKeys: string[];
  selectableHolidays: { key: string; name: string }[];
  /** Null without payroll.manage. */
  rates: RateChange[] | null;
  today: string;
}) {
  const t = useTranslations("monthly");
  const tDays = useTranslations("schedule");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [ownWeekend, setOwnWeekend] = useState(props.ownWeekend);
  const [weekendDays, setWeekendDays] = useState<IsoWeekday[]>(props.weekendDays);
  const [holidayKeys, setHolidayKeys] = useState<string[]>(props.holidayKeys);
  const [rateFrom, setRateFrom] = useState(props.today.slice(0, 8) + "01");
  const [rate, setRate] = useState("");

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          toast.success(success);
          router.refresh();
        } else {
          toast.error(
            t(
              `errors.${result.error === "denied" || result.error === "invalid" ? result.error : "unexpected"}`,
            ),
          );
        }
      } catch {
        toast.error(t("errors.offline"));
      }
    });

  const saveCalendar = () =>
    run(
      () =>
        saveWorkCalendarAction({
          employeeId: props.employeeId,
          ownWeekend,
          weekendDays,
          holidayKeys,
        }),
      t("calendarSavedToast", { name: props.employeeName }),
    );

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("employeeSettings", { name: props.employeeName })}
        onClick={() => setOpen(true)}
      >
        <SettingsIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t("employeeSettings", { name: props.employeeName })}</SheetTitle>
            <SheetDescription>{t("employeeSettingsDescription")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4">
            <FieldGroup>
              <FieldSet>
                <FieldLegend>{t("weekendTitle")}</FieldLegend>
                <Field orientation="horizontal">
                  <Checkbox
                    id="own-weekend"
                    checked={ownWeekend}
                    onCheckedChange={(value) => {
                      setOwnWeekend(value === true);
                      if (value !== true) setWeekendDays(props.orgWeekendDays);
                    }}
                  />
                  <FieldLabel htmlFor="own-weekend">{t("ownWeekendLabel")}</FieldLabel>
                </Field>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => (
                    <label key={day} className="flex items-center gap-1 text-sm">
                      <Checkbox
                        disabled={!ownWeekend}
                        checked={weekendDays.includes(day)}
                        onCheckedChange={(value) =>
                          setWeekendDays((current) =>
                            value === true
                              ? [...current, day].sort()
                              : current.filter((item) => item !== day),
                          )
                        }
                      />
                      {tDays(`weekdays.${day}`)}
                    </label>
                  ))}
                </div>
                <FieldDescription>{t("weekendHint")}</FieldDescription>
              </FieldSet>
              <FieldSet>
                <FieldLegend>{t("holidaysTitle")}</FieldLegend>
                {props.selectableHolidays.length === 0 ? (
                  <FieldDescription>{t("noSelectableHolidays")}</FieldDescription>
                ) : (
                  props.selectableHolidays.map((holiday) => (
                    <label key={holiday.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={holidayKeys.includes(holiday.key)}
                        onCheckedChange={(value) =>
                          setHolidayKeys((current) =>
                            value === true
                              ? [...current, holiday.key]
                              : current.filter((key) => key !== holiday.key),
                          )
                        }
                      />
                      {holiday.name}
                    </label>
                  ))
                )}
              </FieldSet>
              <div>
                <Button disabled={pending} onClick={saveCalendar}>
                  {t("saveCalendar")}
                </Button>
              </div>

              {props.rates !== null ? (
                <FieldSet>
                  <FieldLegend>{t("ratesTitle")}</FieldLegend>
                  {props.rates.length === 0 ? (
                    <FieldDescription>{t("noOwnRate")}</FieldDescription>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {props.rates.map((item) => (
                        <li
                          key={item.validFrom}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="tabular-nums">
                            {t("rateFrom", {
                              date: formatDay(item.validFrom),
                              rate: formatMoney(item.rate),
                            })}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("removeRate")}
                            disabled={pending}
                            onClick={() =>
                              run(
                                () =>
                                  setHourlyRateAction({
                                    employeeId: props.employeeId,
                                    validFrom: item.validFrom,
                                    rate: "",
                                  }),
                                t("rateSavedToast"),
                              )
                            }
                          >
                            <Trash2Icon />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid grid-cols-[1fr_8rem] gap-2">
                    <Field>
                      <FieldLabel htmlFor="rate-from">{t("rateValidFrom")}</FieldLabel>
                      <Input
                        id="rate-from"
                        type="date"
                        value={rateFrom}
                        onChange={(event) => setRateFrom(event.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="rate-value">{t("rateValue")}</FieldLabel>
                      <Input
                        id="rate-value"
                        inputMode="decimal"
                        value={rate}
                        onChange={(event) => setRate(event.target.value)}
                      />
                    </Field>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      disabled={pending || rate.trim() === "" || rateFrom === ""}
                      onClick={() =>
                        run(
                          () =>
                            setHourlyRateAction({
                              employeeId: props.employeeId,
                              validFrom: rateFrom,
                              rate,
                            }),
                          t("rateSavedToast"),
                        )
                      }
                    >
                      {t("addRate")}
                    </Button>
                  </div>
                  <FieldDescription>{t("rateHint")}</FieldDescription>
                </FieldSet>
              ) : null}
            </FieldGroup>
          </div>
          <SheetFooter className="border-t">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("close")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
