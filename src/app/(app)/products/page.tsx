import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { listCatalogOptions } from "@/modules/catalogs/queries";
import { parseProductListParams } from "@/modules/products/list-params";
import { listProductsPage } from "@/modules/products/queries";
import { CreateProductButton } from "./product-sheet";
import { ProductsTable } from "./products-table";

export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <PageSuspense>
      <ProductsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function ProductsContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("products"), getMemberAccess(member)]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("products.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }
  const canManage = access.permissions.has("products.manage");

  const params = parseProductListParams(await searchParams);
  const [page, catalogs] = await Promise.all([
    listProductsPage(organizationId, params),
    listCatalogOptions(organizationId, ["product_type", "material_shape"]),
  ]);
  const catalogOptions = { types: catalogs.product_type, shapes: catalogs.material_shape };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={canManage ? <CreateProductButton catalogs={catalogOptions} /> : null}
      />
      <ProductsTable
        rows={page.rows}
        total={page.total}
        params={{
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          type: params.type ?? "",
          shape: params.shape ?? "",
          view: params.view ?? "",
        }}
        catalogs={catalogOptions}
        canManage={canManage}
      />
    </>
  );
}
