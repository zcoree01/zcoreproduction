import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import {
  getDeliverySettings,
  listDeliveryCustomers,
  listDeliveryTemplates,
  listFinishedStock,
  logoUrl,
} from "@/modules/finished-goods/queries";
import { DeliveryNoteForm } from "./delivery-note-form";

export default function NewDeliveryNotePage({
  searchParams,
}: PageProps<"/inventory/delivery-notes/new">) {
  return (
    <PageSuspense>
      <NewDeliveryNoteContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function NewDeliveryNoteContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access, params] = await Promise.all([
    getTranslations("finishedGoods"),
    getMemberAccess(member),
    searchParams,
  ]);
  if (!access.modules.has("finished_goods")) return <ModuleDisabled />;
  if (!access.permissions.has("finished_goods.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const [stock, customers, templates, settings] = await Promise.all([
    listFinishedStock(organizationId),
    listDeliveryCustomers(organizationId),
    listDeliveryTemplates(organizationId),
    getDeliverySettings(organizationId),
  ]);
  const logo = await logoUrl(settings.logoPath);
  const customer = z.uuid().safeParse(params.customer);

  return (
    <>
      <PageHeader title={t("form.title")} description={t("form.description")} />
      <DeliveryNoteForm
        stock={stock}
        customers={customers.filter((c) => stock.some((row) => row.customerId === c.id))}
        templates={templates.filter((tpl) => !tpl.archived)}
        initialCustomerId={customer.success ? customer.data : ""}
        today={zonedDate(new Date(), member.organization.timezone)}
        organizationName={member.organization.name}
        logoUrl={logo}
        numbers={settings.numbers}
      />
    </>
  );
}
