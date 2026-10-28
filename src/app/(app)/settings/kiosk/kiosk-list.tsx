"use client";

import { BanIcon, KeyRoundIcon, PlusIcon, TabletIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  createKioskActivationAction,
  revokeKioskAction,
  type Activation,
} from "@/modules/attendance/kiosk-admin";
import type { KioskRow } from "@/modules/attendance/kiosk-queries";

const TONES: Record<KioskRow["status"], StatusTone> = {
  active: "success",
  pending: "warning",
  expired: "neutral",
  revoked: "danger",
};

/** Kiosk tablets: add one (shows the one-time code), new code, revoke. */
export function KioskList({
  kiosks,
  kioskUrl,
}: {
  kiosks: (KioskRow & { lastSeen: string | null })[];
  kioskUrl: string;
}) {
  const t = useTranslations("kioskSettings");
  const router = useRouter();
  const [name, setName] = useState("");
  const [activation, setActivation] = useState<(Activation & { name: string }) | null>(null);
  const [revoking, setRevoking] = useState<KioskRow | null>(null);
  const [pending, startTransition] = useTransition();

  const activate = (kioskId: string | null, kioskName: string) =>
    startTransition(async () => {
      const result = await createKioskActivationAction(kioskId, kioskName);
      if (result.ok) {
        setActivation({ ...result.value, name: kioskName });
        setName("");
        router.refresh();
      } else toast.error(t(`errors.${result.error}`));
    });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t("kiosksTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("kiosksDescription", { url: kioskUrl })}</p>
      </div>
      {activation ? (
        <Alert data-testid="kiosk-activation">
          <KeyRoundIcon />
          <AlertTitle>{t("codeTitle", { name: activation.name })}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span className="font-mono text-3xl tracking-[0.3em]" data-testid="kiosk-code">
              {activation.code}
            </span>
            <span>{t("codeHint", { url: kioskUrl })}</span>
          </AlertDescription>
        </Alert>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          activate(null, name);
        }}
      >
        <Input
          aria-label={t("kioskName")}
          placeholder={t("kioskName")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          className="w-64"
        />
        <Button type="submit" disabled={pending || name.trim() === ""}>
          <PlusIcon />
          {t("addKiosk")}
        </Button>
      </form>
      {kiosks.length === 0 ? (
        <EmptyState
          icon={<TabletIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.lastSeen")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kiosks.map((kiosk) => (
                <TableRow key={kiosk.id}>
                  <TableCell className="font-medium">{kiosk.name}</TableCell>
                  <TableCell>
                    <StatusBadge tone={TONES[kiosk.status]}>
                      {t(`status.${kiosk.status}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="tabular-nums">{kiosk.lastSeen ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => activate(kiosk.id, kiosk.name)}
                      >
                        <KeyRoundIcon />
                        {t("newCode")}
                      </Button>
                      {kiosk.status !== "revoked" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() => setRevoking(kiosk)}
                        >
                          <BanIcon />
                          {t("revoke")}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("revokeTitle", { name: revoking?.name ?? "" })}
        description={t("revokeDescription")}
        confirmLabel={t("revoke")}
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          const result = await revokeKioskAction(revoking.id);
          if (result.ok) {
            toast.success(t("revokedToast"));
            router.refresh();
          } else toast.error(t(`errors.${result.error}`));
        }}
      />
    </section>
  );
}
