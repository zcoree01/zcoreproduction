import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { listCatalogOptions } from "@/modules/catalogs/queries";
import { parseMachineListParams } from "@/modules/machines/list-params";
import { listMachinesPage } from "@/modules/machines/queries";
import { CreateMachineButton } from "./machine-sheet";
import { MachinesTable } from "./machines-table";

export default function MachinesPage({ searchParams }: PageProps<"/machines">) {
  return (
    <PageSuspense>
      <MachinesContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function MachinesContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("machines"), getMemberAccess(member)]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("machines.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const canManage = access.permissions.has("machines.manage");

  const params = parseMachineListParams(await searchParams);
  const [page, catalogs] = await Promise.all([
    listMachinesPage(organizationId, params),
    listCatalogOptions(organizationId, ["machine_type", "location"]),
  ]);
  const catalogOptions = { types: catalogs.machine_type, locations: catalogs.location };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canManage ? <CreateMachineButton catalogs={catalogOptions} /> : null}
      />
      <MachinesTable
        rows={page.rows}
        total={page.total}
        params={{
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          status: params.status ?? "",
          type: params.type ?? "",
          location: params.location ?? "",
          view: params.view ?? "",
        }}
        catalogs={catalogOptions}
        canManage={canManage}
      />
    </>
  );
}
