"use client";

import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  PencilIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  archiveTemplateAction,
  prepareLogoUploadAction,
  registerLogoAction,
  saveNumberSettingsAction,
  saveTemplateAction,
  setCustomerTemplateAction,
} from "@/modules/finished-goods/actions";
import type { DeliveryTemplate } from "@/modules/finished-goods/queries";
import {
  DEFAULT_COLUMN_LABELS,
  DEFAULT_LAYOUT,
  DELIVERY_COLUMNS,
  formatDeliveryNumber,
  isValidDeliveryNumberTemplate,
  type DeliveryColumn,
  type DeliveryNumberSettings,
  type DeliveryTemplateLayout,
} from "@/modules/finished-goods/rules";
import {
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
  ORGANIZATION_FILES_BUCKET,
} from "@/modules/finished-goods/schemas";

export function DeliverySettingsView({
  numbers,
  logo,
  templates,
  customers,
  today,
}: {
  numbers: DeliveryNumberSettings;
  logo: string | null;
  templates: DeliveryTemplate[];
  customers: { id: string; name: string; number: number; templateId: string | null }[];
  today: string;
}) {
  const t = useTranslations("finishedGoods.settings");
  const [editing, setEditing] = useState<DeliveryTemplate | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const tErrors = useTranslations("finishedGoods.errors");

  const archive = (template: DeliveryTemplate) =>
    startTransition(async () => {
      const result = await archiveTemplateAction(template.id);
      if (result.ok) {
        toast.success(t("templateArchived"));
      } else toast.error(tErrors(result.error));
    });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <NumberSettings numbers={numbers} today={today} />
      <LogoSettings logo={logo} />
      <Card>
        <CardHeader>
          <CardTitle>{t("templatesTitle")}</CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
              <PlusIcon />
              {t("templateNew")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  {template.name}
                  {template.isDefault ? (
                    <Badge variant="secondary">{t("defaultBadge")}</Badge>
                  ) : null}
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("templateEdit", { name: template.name })}
                    onClick={() => setEditing(template)}
                  >
                    <PencilIcon />
                  </Button>
                  {template.isDefault ? null : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={pending}
                      aria-label={t("templateArchive", { name: template.name })}
                      onClick={() => archive(template)}
                    >
                      <ArchiveIcon />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <CustomerTemplates customers={customers} templates={templates} />
      <Sheet open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <SheetContent className="w-full gap-0 sm:max-w-xl">
          {editing ? (
            <TemplateForm
              key={editing === "new" ? "new" : editing.id}
              template={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NumberSettings({ numbers, today }: { numbers: DeliveryNumberSettings; today: string }) {
  const t = useTranslations("finishedGoods.settings");
  const tErrors = useTranslations("finishedGoods.errors");
  const [template, setTemplate] = useState(numbers.template);
  const [digits, setDigits] = useState(String(numbers.digits));
  const [pending, startTransition] = useTransition();
  const valid = isValidDeliveryNumberTemplate(template.trim());
  const digitCount = Math.min(6, Math.max(1, Number(digits) || 1));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveNumberSettingsAction({
        template: template.trim(),
        digits: digitCount,
      });
      if (result.ok) toast.success(t("saved"));
      else toast.error(tErrors(result.error));
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("numberTitle")}</CardTitle>
        <CardDescription>{t("numberHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
          <Field className="min-w-64 flex-1" data-invalid={valid ? undefined : true}>
            <FieldLabel htmlFor="number-template">{t("numberTemplate")}</FieldLabel>
            <Input
              id="number-template"
              value={template}
              className="font-mono"
              onChange={(event) => setTemplate(event.target.value)}
            />
            {valid ? (
              <FieldDescription>
                {t("numberPreview", {
                  example: formatDeliveryNumber({
                    template: template.trim(),
                    digits: digitCount,
                    customerNumber: 3,
                    date: today,
                    sequence: 122,
                  }),
                })}
              </FieldDescription>
            ) : (
              <FieldError>{t("numberInvalid")}</FieldError>
            )}
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="number-digits">{t("numberDigits")}</FieldLabel>
            <NativeSelect
              id="number-digits"
              className="w-full"
              value={digits}
              onChange={(event) => setDigits(event.target.value)}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <NativeSelectOption key={n} value={String(n)}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" disabled={pending || !valid}>
            {t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LogoSettings({ logo }: { logo: string | null }) {
  const t = useTranslations("finishedGoods.settings");
  const tErrors = useTranslations("finishedGoods.errors");
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const upload = (file: File | undefined) => {
    if (!file) return;
    startTransition(async () => {
      if (file.size > LOGO_MAX_BYTES || !(file.type in LOGO_CONTENT_TYPES)) {
        toast.error(tErrors("file_type"));
        return;
      }
      const ticket = await prepareLogoUploadAction({ contentType: file.type, size: file.size });
      if (!ticket.ok) {
        toast.error(tErrors(ticket.error));
        return;
      }
      const uploaded = await createClient()
        .storage.from(ORGANIZATION_FILES_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (uploaded.error) {
        toast.error(tErrors("upload_failed"));
        return;
      }
      const result = await registerLogoAction(ticket.path);
      if (result.ok) {
        toast.success(t("logoUploaded"));
      } else toast.error(tErrors(result.error));
      if (input.current) input.current.value = "";
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("logoTitle")}</CardTitle>
        <CardDescription>{t("logoHint")}</CardDescription>
        <CardAction>
          <input
            ref={input}
            type="file"
            accept={Object.keys(LOGO_CONTENT_TYPES).join(",")}
            className="sr-only"
            aria-label={t("logoUpload")}
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <UploadIcon />
            {t("logoUpload")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {logo ? (
          <Image
            src={logo}
            alt={t("logoTitle")}
            width={224}
            height={64}
            unoptimized
            className="h-16 w-auto max-w-56 rounded border bg-white object-contain p-1"
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("logoNone")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function CustomerTemplates({
  customers,
  templates,
}: {
  customers: { id: string; name: string; templateId: string | null }[];
  templates: DeliveryTemplate[];
}) {
  const t = useTranslations("finishedGoods.settings");
  const tErrors = useTranslations("finishedGoods.errors");
  const [pending, startTransition] = useTransition();

  const choose = (customerId: string, templateId: string) =>
    startTransition(async () => {
      const result = await setCustomerTemplateAction(customerId, templateId || null);
      if (result.ok) toast.success(t("customerSaved"));
      else toast.error(tErrors(result.error));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("customersTitle")}</CardTitle>
        <CardDescription>{t("customersHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {customers.map((customer) => (
            <li
              key={customer.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span>{customer.name}</span>
              <NativeSelect
                aria-label={t("customerTemplate", { customer: customer.name })}
                className="w-56"
                defaultValue={customer.templateId ?? ""}
                disabled={pending}
                onChange={(event) => choose(customer.id, event.target.value)}
              >
                <NativeSelectOption value="">{t("templateDefaultOption")}</NativeSelectOption>
                {templates.map((tpl) => (
                  <NativeSelectOption key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TemplateForm({
  template,
  onDone,
}: {
  template: DeliveryTemplate | null;
  onDone: () => void;
}) {
  const t = useTranslations("finishedGoods.settings");
  const tErrors = useTranslations("finishedGoods.errors");
  const start = template?.layout ?? DEFAULT_LAYOUT;
  const [name, setName] = useState(template?.name ?? "");
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [title, setTitle] = useState(start.title);
  const [header, setHeader] = useState(start.header_text);
  const [footer, setFooter] = useState(start.footer_text);
  const [showLogo, setShowLogo] = useState(start.show_logo);
  const [signatures, setSignatures] = useState(start.signatures.join("\n"));
  // Every column with its label; the shown ones keep their order first.
  const [columns, setColumns] = useState<{ key: DeliveryColumn; label: string; shown: boolean }[]>(
    () => [
      ...start.columns.map((c) => ({ ...c, shown: true })),
      ...DELIVERY_COLUMNS.filter((key) => !start.columns.some((c) => c.key === key)).map((key) => ({
        key,
        label: DEFAULT_COLUMN_LABELS[key],
        shown: false,
      })),
    ],
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const move = (index: number, direction: -1 | 1) =>
    setColumns((current) => {
      const next = [...current];
      const target = index + direction;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  const patch = (index: number, change: Partial<{ label: string; shown: boolean }>) =>
    setColumns((current) => current.map((c, i) => (i === index ? { ...c, ...change } : c)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFailed(null);
    const layout: DeliveryTemplateLayout = {
      title: title.trim(),
      header_text: header,
      footer_text: footer,
      show_logo: showLogo,
      columns: columns
        .filter((c) => c.shown)
        .map(({ key, label }) => ({ key, label: label.trim() })),
      signatures: signatures
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4),
    };
    startTransition(async () => {
      const result = await saveTemplateAction(template?.id ?? null, { name, isDefault, layout });
      if (result.ok) {
        toast.success(t("templateSaved"));
        onDone();
      } else setFailed(tErrors(result.error));
    });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>
          {template ? t("templateEdit", { name: template.name }) : t("templateNew")}
        </SheetTitle>
        <SheetDescription>{t("description")}</SheetDescription>
      </SheetHeader>
      <form id="template-form" onSubmit={submit} noValidate className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {failed ? <FieldError>{failed}</FieldError> : null}
          <Field>
            <FieldLabel htmlFor="tpl-name">{t("name")}</FieldLabel>
            <Input id="tpl-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={isDefault}
              disabled={template?.isDefault === true}
              onCheckedChange={(value) => setIsDefault(value === true)}
            />
            {t("isDefault")}
          </Label>
          <Field>
            <FieldLabel htmlFor="tpl-title">{t("docTitle")}</FieldLabel>
            <Input
              id="tpl-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={showLogo} onCheckedChange={(value) => setShowLogo(value === true)} />
            {t("showLogo")}
          </Label>
          <Field>
            <FieldLabel htmlFor="tpl-header">{t("headerText")}</FieldLabel>
            <Textarea
              id="tpl-header"
              rows={2}
              value={header}
              onChange={(event) => setHeader(event.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t("columns")}</legend>
            {columns.map((column, index) => {
              const name = t(`columnKeys.${column.key}`);
              return (
                <div key={column.key} className="flex items-center gap-2">
                  <Checkbox
                    checked={column.shown}
                    aria-label={t("columnShown", { column: name })}
                    onCheckedChange={(value) => patch(index, { shown: value === true })}
                  />
                  <span className="w-32 text-sm text-muted-foreground">{name}</span>
                  <Input
                    value={column.label}
                    aria-label={t("columnLabel", { column: name })}
                    disabled={!column.shown}
                    className="flex-1"
                    onChange={(event) => patch(index, { label: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("moveUp", { column: name })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("moveDown", { column: name })}
                    disabled={index === columns.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                </div>
              );
            })}
          </fieldset>
          <Field>
            <FieldLabel htmlFor="tpl-footer">{t("footerText")}</FieldLabel>
            <Textarea
              id="tpl-footer"
              rows={2}
              value={footer}
              onChange={(event) => setFooter(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tpl-signatures">{t("signatures")}</FieldLabel>
            <Textarea
              id="tpl-signatures"
              rows={3}
              value={signatures}
              onChange={(event) => setSignatures(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
      <SheetFooter className="border-t">
        <Button type="submit" form="template-form" disabled={pending}>
          {t("save")}
        </Button>
      </SheetFooter>
    </>
  );
}
