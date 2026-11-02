"use client";

import {
  ArchiveIcon,
  ArrowRightLeftIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  WrenchIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { matchesAllWords } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { StockLocation } from "@/modules/inventory/queries";
import type { MachineOption } from "@/modules/machines/queries";
import { moveToolAction, saveToolAction, setToolArchivedAction } from "@/modules/tools/actions";
import type { ToolRow } from "@/modules/tools/queries";
import { TOOL_KINDS, TOOL_MOVES, type ToolKind, type ToolMove } from "@/modules/tools/schemas";

export function ToolList({
  tools,
  locations,
  machines,
  canManage,
}: {
  tools: ToolRow[];
  locations: StockLocation[];
  machines: MachineOption[];
  canManage: boolean;
}) {
  const t = useTranslations("tools");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ToolRow | "new" | null>(null);
  const [moving, setMoving] = useState<ToolRow | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = useMemo(
    () =>
      tools.filter(
        (tool) =>
          (showArchived || !tool.archived) && matchesAllWords(`${tool.code} ${tool.name}`, query),
      ),
    [tools, showArchived, query],
  );

  const setArchived = (tool: ToolRow, archived: boolean) =>
    startTransition(async () => {
      const result = await setToolArchivedAction(tool.id, archived);
      if (result.ok) {
        toast.success(t(archived ? "archivedToast" : "restoredToast"));
      } else toast.error(t(`errors.${result.error}`));
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="w-full sm:w-72"
        />
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={showArchived}
            onCheckedChange={(value) => setShowArchived(value === true)}
          />
          {t("showArchived")}
        </Label>
        {canManage ? (
          <Button className="ml-auto" onClick={() => setEditing("new")}>
            <PlusIcon />
            {t("add")}
          </Button>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<WrenchIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.code")}</TableHead>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.where")}</TableHead>
                <TableHead className="text-right">{t("columns.total")}</TableHead>
                {canManage ? (
                  <TableHead>
                    <span className="sr-only">{t("columns.actions")}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((tool) => (
                <TableRow key={tool.id} className={cn(tool.archived && "opacity-60")}>
                  <TableCell className="font-mono font-medium">{tool.code}</TableCell>
                  <TableCell>
                    <div>{tool.name}</div>
                    {tool.homeMachine ? (
                      <div className="text-xs text-muted-foreground">
                        {t("home", { machine: tool.homeMachine })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {t(`kinds.${tool.kind}`)}
                    {tool.cuttingEdges ? (
                      <div className="text-xs text-muted-foreground">
                        {t("edges", { edges: tool.cuttingEdges })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {tool.stock.length === 0 ? (
                      <span className="text-muted-foreground">{t("nowhere")}</span>
                    ) : (
                      <ul className="flex flex-col text-sm">
                        {tool.stock.map((s) => (
                          <li key={s.locationId}>
                            {s.location}:{" "}
                            <span className="tabular-nums">
                              {t("pieces", { count: s.quantity })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {tool.inUse.map((use) => (
                      <div key={use.machine} className="text-xs text-muted-foreground">
                        {t("inUse", {
                          machine: use.machine,
                          used: use.edgesUsed,
                          edges: tool.cuttingEdges ?? 0,
                        })}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t("pieces", { count: tool.total })}
                    {tool.belowMinimum ? (
                      <Badge variant="destructive" className="ml-2">
                        {t("belowMinimum")}
                      </Badge>
                    ) : null}
                    {tool.archived ? (
                      <Badge variant="secondary" className="ml-2">
                        {t("archived")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {tool.archived ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => setArchived(tool, false)}
                          >
                            <RotateCcwIcon />
                            {t("restore")}
                          </Button>
                        ) : (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setMoving(tool)}>
                              <ArrowRightLeftIcon />
                              {t("move")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${t("edit")} ${tool.code}`}
                              onClick={() => setEditing(tool)}
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending}
                              aria-label={`${t("archive")} ${tool.code}`}
                              onClick={() => setArchived(tool, true)}
                            >
                              <ArchiveIcon />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          {editing ? (
            <ToolForm
              key={editing === "new" ? "new" : editing.id}
              tool={editing === "new" ? null : editing}
              machines={machines}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <Sheet open={moving !== null} onOpenChange={(open) => (open ? null : setMoving(null))}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          {moving ? (
            <MoveForm
              key={moving.id}
              tool={moving}
              locations={locations}
              machines={machines}
              onDone={() => setMoving(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ToolForm({
  tool,
  machines,
  onDone,
}: {
  tool: ToolRow | null;
  machines: MachineOption[];
  onDone: () => void;
}) {
  const t = useTranslations("tools");
  const [code, setCode] = useState(tool?.code ?? "");
  const [name, setName] = useState(tool?.name ?? "");
  const [kind, setKind] = useState<ToolKind>(tool?.kind ?? "tool");
  const [edges, setEdges] = useState(tool?.cuttingEdges ? String(tool.cuttingEdges) : "");
  const [homeMachineId, setHomeMachineId] = useState(tool?.homeMachineId ?? "");
  const [minStock, setMinStock] = useState(
    tool?.minStock === null || tool?.minStock === undefined ? "" : String(tool.minStock),
  );
  const [supplier, setSupplier] = useState(tool?.supplier ?? "");
  const [notes, setNotes] = useState(tool?.notes ?? "");
  const [failure, setFailure] = useState<{ error: string; fields: readonly string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const result = await saveToolAction(tool?.id ?? null, {
        code,
        name,
        kind,
        cuttingEdges: kind === "insert" ? edges : "",
        homeMachineId,
        minStock,
        supplier,
        notes,
      });
      if (result.ok) {
        toast.success(t("form.saved"));
        onDone();
      } else setFailure({ error: result.error, fields: result.fields });
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{tool ? t("form.titleEdit") : t("form.titleNew")}</SheetTitle>
        <SheetDescription>{t("form.description")}</SheetDescription>
      </SheetHeader>
      <form id="tool-form" onSubmit={submit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failure && failure.fields.length === 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${failure.error as "unexpected"}`)}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={invalid("code") || undefined}>
            <FieldLabel htmlFor="tool-code">{t("form.code")}</FieldLabel>
            <Input id="tool-code" value={code} onChange={(event) => setCode(event.target.value)} />
            {invalid("code") ? (
              <FieldError>
                {failure?.error === "code_taken" ? t("errors.code_taken") : t("errors.invalid")}
              </FieldError>
            ) : null}
          </Field>
          <Field data-invalid={invalid("name") || undefined}>
            <FieldLabel htmlFor="tool-name-input">{t("form.name")}</FieldLabel>
            <Input
              id="tool-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tool-kind">{t("form.kind")}</FieldLabel>
            <NativeSelect
              id="tool-kind"
              className="w-full"
              value={kind}
              onChange={(event) => setKind(event.target.value as ToolKind)}
            >
              {TOOL_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`kinds.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {kind === "insert" ? (
            <Field data-invalid={invalid("cuttingEdges") || undefined}>
              <FieldLabel htmlFor="tool-edges">{t("form.cuttingEdges")}</FieldLabel>
              <Input
                id="tool-edges"
                inputMode="numeric"
                value={edges}
                onChange={(event) => setEdges(event.target.value)}
              />
              {invalid("cuttingEdges") ? <FieldError>{t("errors.invalid")}</FieldError> : null}
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="tool-home">{t("form.homeMachine")}</FieldLabel>
            <NativeSelect
              id="tool-home"
              className="w-full"
              value={homeMachineId}
              onChange={(event) => setHomeMachineId(event.target.value)}
            >
              <NativeSelectOption value="">{t("form.homeMachineNone")}</NativeSelectOption>
              {machines.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={invalid("minStock") || undefined}>
            <FieldLabel htmlFor="tool-min">{t("form.minStock")}</FieldLabel>
            <Input
              id="tool-min"
              inputMode="numeric"
              value={minStock}
              onChange={(event) => setMinStock(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tool-supplier">{t("form.supplier")}</FieldLabel>
            <Input
              id="tool-supplier"
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tool-notes-input">{t("form.notes")}</FieldLabel>
            <Textarea
              id="tool-notes-input"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="tool-form" disabled={pending}>
          {t("form.save")}
        </Button>
      </SheetFooter>
    </>
  );
}

function MoveForm({
  tool,
  locations,
  machines,
  onDone,
}: {
  tool: ToolRow;
  locations: StockLocation[];
  machines: MachineOption[];
  onDone: () => void;
}) {
  const t = useTranslations("tools");
  const [key] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<ToolMove>(tool.stock.length === 0 ? "receipt" : "issue");
  const [quantity, setQuantity] = useState("1");
  const [fromId, setFromId] = useState(tool.stock[0]?.locationId ?? "");
  const [toId, setToId] = useState(locations.find((l) => l.kind === "warehouse")?.id ?? "");
  const [machineId, setMachineId] = useState(tool.homeMachineId ?? "");
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<{ error: string; fields: readonly string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = (field: string) => failure?.fields.includes(field) ?? false;
  const needsFrom = kind !== "receipt";
  const needsTo = kind === "receipt" || kind === "return" || kind === "transfer";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const result = await moveToolAction({
        idempotencyKey: key,
        kind,
        toolId: tool.id,
        quantity,
        fromId: needsFrom ? fromId : "",
        toId: needsTo ? toId : "",
        machineId: kind === "issue" ? machineId : "",
        reason,
      });
      if (result.ok) {
        toast.success(t("moveForm.done"));
        onDone();
      } else setFailure({ error: result.error, fields: result.fields });
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("moveForm.title", { tool: `${tool.code} · ${tool.name}` })}</SheetTitle>
        <SheetDescription>{t("moveForm.description")}</SheetDescription>
      </SheetHeader>
      <form id="tool-move-form" onSubmit={submit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failure && failure.fields.length === 0 ? (
            <Alert variant="destructive">
              <AlertDescription>{t(`errors.${failure.error as "unexpected"}`)}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="move-kind">{t("moveForm.kind")}</FieldLabel>
            <NativeSelect
              id="move-kind"
              className="h-12 w-full"
              value={kind}
              onChange={(event) => setKind(event.target.value as ToolMove)}
            >
              {TOOL_MOVES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`moveForm.kinds.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={invalid("quantity") || undefined}>
            <FieldLabel htmlFor="move-quantity">{t("moveForm.quantity")}</FieldLabel>
            <Input
              id="move-quantity"
              inputMode="numeric"
              className="h-12 text-lg"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
          {needsFrom ? (
            <Field data-invalid={invalid("fromId") || undefined}>
              <FieldLabel htmlFor="move-from">{t("moveForm.from")}</FieldLabel>
              <NativeSelect
                id="move-from"
                className="h-12 w-full"
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
              >
                <NativeSelectOption value="">{t("moveForm.fromPlaceholder")}</NativeSelectOption>
                {tool.stock.map((s) => (
                  <NativeSelectOption key={s.locationId} value={s.locationId}>
                    {s.location} ({t("pieces", { count: s.quantity })})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {needsTo ? (
            <Field data-invalid={invalid("toId") || undefined}>
              <FieldLabel htmlFor="move-to">{t("moveForm.to")}</FieldLabel>
              <NativeSelect
                id="move-to"
                className="h-12 w-full"
                value={toId}
                onChange={(event) => setToId(event.target.value)}
              >
                <NativeSelectOption value="">{t("moveForm.fromPlaceholder")}</NativeSelectOption>
                {locations.map((l) => (
                  <NativeSelectOption key={l.id} value={l.id}>
                    {l.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {kind === "issue" ? (
            <Field data-invalid={invalid("machineId") || undefined}>
              <FieldLabel htmlFor="move-machine">{t("moveForm.machine")}</FieldLabel>
              <NativeSelect
                id="move-machine"
                className="h-12 w-full"
                value={machineId}
                onChange={(event) => setMachineId(event.target.value)}
              >
                <NativeSelectOption value="">{t("moveForm.machinePlaceholder")}</NativeSelectOption>
                {machines.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field data-invalid={invalid("reason") || undefined}>
            <FieldLabel htmlFor="move-reason">{t("moveForm.reason")}</FieldLabel>
            <Textarea
              id="move-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            {invalid("reason") ? <FieldError>{t("errors.reason_required")}</FieldError> : null}
          </Field>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="tool-move-form" size="lg" disabled={pending}>
          {t("moveForm.submit")}
        </Button>
      </SheetFooter>
    </>
  );
}
