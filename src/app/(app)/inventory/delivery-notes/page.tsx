import { PlusIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import { parseDeliveryNoteListParams } from "@/modules/finished-goods/list-params";
import { listDeliveryNotesPage } from "@/modules/finished-goods/queries";
import { DeliveryNotesTable } from "./delivery-notes-table";

export default function DeliveryNotesPage({
  searchParams,
}: PageProps<"/inventory/delivery-notes">) {
  return (
    <PageSuspense>
      <DeliveryNotesContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function DeliveryNotesContent({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const [t, access] = await Promise.all([
    getTranslations("finishedGoods"),
    getMemberAccess(member),
  ]);
  if (!access.modules.has("finished_goods")) return <ModuleDisabled />;
  if (!access.permissions.has("finished_goods.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const params = parseDeliveryNoteListParams(await searchParams);
  const page = await listDeliveryNotesPage(member.organization.id, params);
  const newButton = access.permissions.has("finished_goods.manage") ? (
    <Link href="/inventory/delivery-notes/new" className={cn(buttonVariants())}>
      <PlusIcon />
      {t("notes.new")}
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title={t("notes.title")}
        description={t("notes.description")}
        actions={newButton}
      />
      <DeliveryNotesTable
        rows={page.rows}
        total={page.total}
        params={{
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          status: params.status ?? "",
        }}
      />
    </>
  );
}
