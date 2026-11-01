"use client";

import { ClipboardListIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { SearchSelect } from "@/components/shared/search-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { openCountAction } from "@/modules/inventory/actions";
import type { StockCountRow, StockItem, StockLocation } from "@/modules/inventory/queries";

type Row = StockCountRow & { createdLabel: string };

export function CountList({
  counts,
  locations,
  items,
  canOpen,
  detailBase,
  initialLocationId,
}: {
  counts: Row[];
  locations: StockLocation[];
  items: StockItem[];
  canOpen: boolean;
  /** /inventory/counts (desktop) or /floor/warehouse/counts (mobile). */
  detailBase: string;
  /** Opens the form for this location right away (from a location label). */
  initialLocationId?: string;
}) {
  const t = useTranslations("inventory.counts");
  const [opening, setOpening] = useState(initialLocationId !== undefined);

  return (
    <div className="flex flex-col gap-4">
      {canOpen ? (
        <Button size="lg" className="w-fit" onClick={() => setOpening(true)}>
          <PlusIcon />
          {t("new")}
        </Button>
      ) : null}
      {counts.length === 0 ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {counts.map((c) => (
            <li key={c.id}>
              <Link
                href={`${detailBase}/${c.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 hover:bg-muted"
              >
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="font-mono">{c.number}</span>
                    <Badge variant={c.status === "submitted" ? "default" : "outline"}>
                      {t(`status.${c.status}`)}
                    </Badge>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {[c.location, c.itemLabel, c.createdLabel].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-sm tabular-nums">
                  {t("progress", { counted: c.counted, lines: c.lines })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canOpen ? (
        <Sheet open={opening} onOpenChange={setOpening}>
          <SheetContent className="w-full gap-0 sm:max-w-md">
            {opening ? (
              <OpenCountForm
                locations={locations}
                items={items}
                detailBase={detailBase}
                initialLocationId={initialLocationId}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}

function OpenCountForm({
  locations,
  items,
  detailBase,
  initialLocationId,
}: {
  locations: StockLocation[];
  items: StockItem[];
  detailBase: string;
  initialLocationId?: string;
}) {
  const t = useTranslations("inventory.counts");
  const tErrors = useTranslations("inventory.errors");
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [locationId, setLocationId] = useState(initialLocationId ?? locations[0]?.id ?? "");
  const [itemId, setItemId] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await openCountAction({ idempotencyKey: key, locationId, itemId, notes });
      if (result.ok) {
        toast.success(t("opened"));
        router.push(`${detailBase}/${result.id}`);
      } else {
        toast.error(tErrors(result.error));
      }
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("newTitle")}</SheetTitle>
        <SheetDescription>{t("newDescription")}</SheetDescription>
      </SheetHeader>
      <form id="open-count-form" onSubmit={submit} className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="count-location">{t("location")}</FieldLabel>
            <NativeSelect
              id="count-location"
              className="h-12 w-full"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((l) => (
                <NativeSelectOption key={l.id} value={l.id}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t("locationHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="count-item">{t("item")}</FieldLabel>
            <SearchSelect
              id="count-item"
              value={itemId}
              onChange={setItemId}
              placeholder={t("itemAll")}
              options={[
                { value: "", label: t("itemAll") },
                ...items.map((i) => ({ value: i.id, label: i.code, hint: i.name })),
              ]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="count-notes">{t("notes")}</FieldLabel>
            <Textarea
              id="count-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="open-count-form" size="lg" disabled={pending || !locationId}>
          {t("open")}
        </Button>
      </SheetFooter>
    </>
  );
}
