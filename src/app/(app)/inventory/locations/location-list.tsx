"use client";

import { ArchiveIcon, MapPinIcon, PencilIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MachineOption } from "@/modules/machines/queries";
import { saveLocationAction, setLocationArchivedAction } from "@/modules/inventory/actions";
import type { StockLocation } from "@/modules/inventory/queries";
import { LOCATION_KINDS, type LocationKind } from "@/modules/inventory/schemas";

type Editing = { location: StockLocation | null; kind: LocationKind; parentId: string };

export function LocationList({
  locations,
  machines,
}: {
  locations: StockLocation[];
  machines: MachineOption[];
}) {
  const t = useTranslations("inventory");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = locations.filter((l) => showArchived || !l.archived);
  const warehouses = visible.filter((l) => l.kind === "warehouse");
  const machinePlaces = visible.filter((l) => l.kind === "machine");

  const setArchived = (location: StockLocation, archived: boolean) =>
    startTransition(async () => {
      const result = await setLocationArchivedAction(location.id, archived);
      if (result.ok) {
        toast.success(
          t(archived ? "locations.archivedToast" : "locations.restoredToast", {
            name: location.name,
          }),
        );
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });

  const actions = (location: StockLocation) =>
    location.archived ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setArchived(location, false)}
      >
        <RotateCcwIcon />
        {t("locations.restore")}
      </Button>
    ) : (
      <>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("locations.edit", { name: location.name })}
          onClick={() =>
            setEditing({ location, kind: location.kind, parentId: location.parentId ?? "" })
          }
        >
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={t("locations.archive", { name: location.name })}
          onClick={() => setArchived(location, true)}
        >
          <ArchiveIcon />
        </Button>
      </>
    );

  const name = (location: StockLocation) => (
    <span className="flex items-center gap-2">
      <span className="font-mono text-sm">{location.code}</span>
      <span>{location.name}</span>
      {location.archived ? <Badge variant="secondary">{t("locations.archivedBadge")}</Badge> : null}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={showArchived}
            onCheckedChange={(value) => setShowArchived(value === true)}
          />
          {t("locations.showArchived")}
        </Label>
        <Button onClick={() => setEditing({ location: null, kind: "warehouse", parentId: "" })}>
          <PlusIcon />
          {t("locations.add")}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<MapPinIcon />}
          title={t("locations.emptyTitle")}
          description={t("locations.emptyDescription")}
        />
      ) : null}

      {warehouses.map((warehouse) => {
        const shelves = visible.filter((l) => l.parentId === warehouse.id);
        return (
          <Card key={warehouse.id} className={warehouse.archived ? "opacity-70" : undefined}>
            <CardHeader>
              <CardTitle>{name(warehouse)}</CardTitle>
              <CardAction className="flex gap-1">
                {warehouse.archived ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditing({ location: null, kind: "shelf", parentId: warehouse.id })
                    }
                  >
                    <PlusIcon />
                    {t("locations.kinds.shelf")}
                  </Button>
                )}
                {actions(warehouse)}
              </CardAction>
            </CardHeader>
            <CardContent>
              {shelves.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("locations.noShelves")}</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {shelves.map((shelf) => (
                    <li key={shelf.id} className="flex items-center justify-between gap-2 py-1.5">
                      {name(shelf)}
                      <span className="flex gap-1">{actions(shelf)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}

      {machinePlaces.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("locations.machinePlaces")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {machinePlaces.map((place) => (
                <li key={place.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="flex flex-col">
                    {name(place)}
                    {place.machineName ? (
                      <span className="text-xs text-muted-foreground">{place.machineName}</span>
                    ) : null}
                  </span>
                  <span className="flex gap-1">{actions(place)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Sheet open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          {editing ? (
            <LocationForm
              key={editing.location?.id ?? `${editing.kind}:${editing.parentId}`}
              editing={editing}
              warehouses={locations.filter((l) => l.kind === "warehouse" && !l.archived)}
              machines={machines}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LocationForm({
  editing,
  warehouses,
  machines,
  onDone,
}: {
  editing: Editing;
  warehouses: StockLocation[];
  machines: MachineOption[];
  onDone: () => void;
}) {
  const t = useTranslations("inventory");
  const { location } = editing;
  const [kind, setKind] = useState<LocationKind>(editing.kind);
  const [parentId, setParentId] = useState(editing.parentId);
  const [machineId, setMachineId] = useState(location?.machineId ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [name, setName] = useState(location?.name ?? "");
  const [failure, setFailure] = useState<{ error: string; fields: readonly string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const result = await saveLocationAction(location?.id ?? null, {
        kind,
        parentId: kind === "shelf" ? parentId : "",
        machineId: kind === "machine" ? machineId : "",
        code,
        name,
      });
      if (result.ok) {
        toast.success(t("locations.saved"));
        onDone();
      } else {
        setFailure({ error: result.error, fields: result.fields });
      }
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{location ? t("locations.titleEdit") : t("locations.titleNew")}</SheetTitle>
        <SheetDescription>{t("locations.description")}</SheetDescription>
      </SheetHeader>
      <form id="location-form" onSubmit={submit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failure && failure.fields.length === 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${failure.error as "unexpected"}`)}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="location-kind">{t("locations.kind")}</FieldLabel>
            <NativeSelect
              id="location-kind"
              className="w-full"
              value={kind}
              disabled={location !== null}
              onChange={(event) => setKind(event.target.value as LocationKind)}
            >
              {LOCATION_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`locations.kinds.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {kind === "shelf" ? (
            <Field data-invalid={invalid("parentId") || undefined}>
              <FieldLabel htmlFor="location-parent">{t("locations.parent")}</FieldLabel>
              <NativeSelect
                id="location-parent"
                className="w-full"
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <NativeSelectOption value="">{t("locations.parentPlaceholder")}</NativeSelectOption>
                {warehouses.map((w) => (
                  <NativeSelectOption key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {invalid("parentId") ? (
                <FieldError>{t("errors.shelf_needs_warehouse")}</FieldError>
              ) : null}
            </Field>
          ) : null}
          {kind === "machine" ? (
            <Field data-invalid={invalid("machineId") || undefined}>
              <FieldLabel htmlFor="location-machine">{t("locations.machine")}</FieldLabel>
              <NativeSelect
                id="location-machine"
                className="w-full"
                value={machineId}
                onChange={(event) => {
                  setMachineId(event.target.value);
                  const machine = machines.find((m) => m.id === event.target.value);
                  if (machine && !code) setCode(machine.code);
                  if (machine && !name) setName(machine.name);
                }}
              >
                <NativeSelectOption value="">
                  {t("locations.machinePlaceholder")}
                </NativeSelectOption>
                {machines.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.code} — {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {invalid("machineId") ? <FieldError>{t("errors.invalid")}</FieldError> : null}
            </Field>
          ) : null}
          <Field data-invalid={invalid("code") || undefined}>
            <FieldLabel htmlFor="location-code">{t("locations.code")}</FieldLabel>
            <Input
              id="location-code"
              value={code}
              autoComplete="off"
              onChange={(event) => setCode(event.target.value)}
              aria-invalid={invalid("code") || undefined}
            />
            {invalid("code") ? (
              <FieldError>
                {failure?.error === "code_taken" ? t("errors.code_taken") : t("errors.invalid")}
              </FieldError>
            ) : (
              <FieldDescription>{t("locations.codeHint")}</FieldDescription>
            )}
          </Field>
          <Field data-invalid={invalid("name") || undefined}>
            <FieldLabel htmlFor="location-name">{t("locations.name")}</FieldLabel>
            <Input
              id="location-name"
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
              aria-invalid={invalid("name") || undefined}
            />
            {invalid("name") ? <FieldError>{t("errors.invalid")}</FieldError> : null}
          </Field>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="location-form" disabled={pending}>
          {t("locations.save")}
        </Button>
      </SheetFooter>
    </>
  );
}
