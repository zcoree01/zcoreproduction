"use client";

import { IdCardIcon, KeyRoundIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  issueBadgeAction,
  setEmployeePinAction,
  type KioskAdminResult,
} from "@/modules/attendance/kiosk-admin";
import type { CredentialRow } from "@/modules/attendance/kiosk-queries";

/** Workers' kiosk credentials: set / remove a PIN, issue a (new) badge. */
export function CredentialList({ credentials }: { credentials: CredentialRow[] }) {
  const t = useTranslations("kioskSettings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  const run = (action: () => Promise<KioskAdminResult>, success: string) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          toast.success(success);
          setEditing(null);
          setPin("");
          router.refresh();
        } else toast.error(t(`errors.${result.error}`));
      } catch {
        toast.error(t("errors.unexpected"));
      }
    });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t("credentialsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("credentialsDescription")}</p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.employee")}</TableHead>
              <TableHead>{t("columns.pin")}</TableHead>
              <TableHead>{t("columns.badge")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((row) => (
              <TableRow key={row.employeeId} data-testid="credential-row">
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground">#{row.number}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge tone={row.hasPin ? "success" : "neutral"}>
                      {row.hasPin ? t("pinSet") : t("pinMissing")}
                    </StatusBadge>
                    {row.lockedUntil ? (
                      <span className="flex items-center gap-1 text-xs text-destructive">
                        <LockIcon className="size-3" aria-hidden />
                        {t("locked")}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={row.badgeToken ? "success" : "neutral"}>
                    {row.badgeToken ? t("badgeIssued") : t("badgeMissing")}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  {editing === row.employeeId ? (
                    <form
                      className="flex items-center justify-end gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        run(() => setEmployeePinAction(row.employeeId, pin), t("pinSavedToast"));
                      }}
                    >
                      <Input
                        aria-label={t("newPin")}
                        inputMode="numeric"
                        maxLength={4}
                        value={pin}
                        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                        className="w-20 text-center font-mono"
                        autoFocus
                      />
                      <Button type="submit" size="sm" disabled={pending || pin.length !== 4}>
                        {t("save")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                      >
                        {t("cancel")}
                      </Button>
                    </form>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setEditing(row.employeeId);
                          setPin("");
                        }}
                      >
                        <KeyRoundIcon />
                        {t("setPin")}
                      </Button>
                      {row.hasPin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setEmployeePinAction(row.employeeId, ""),
                              t("pinRemovedToast"),
                            )
                          }
                        >
                          {t("removePin")}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(() => issueBadgeAction(row.employeeId), t("badgeIssuedToast"))
                        }
                      >
                        <IdCardIcon />
                        {row.badgeToken ? t("reissueBadge") : t("issueBadge")}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
