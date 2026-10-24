import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import { listCatalogItems } from "@/modules/catalogs/queries";
import { manageableCatalogKinds } from "@/modules/catalogs/schemas";
import { CatalogList } from "./catalog-list";

export default function CatalogsPage({ searchParams }: PageProps<"/settings/catalogs">) {
  return (
    <PageSuspense>
      <CatalogsContent searchParams={searchParams} />
    </PageSuspense>
  );
}

async function CatalogsContent({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("catalogs"), getMemberAccess(member)]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  const kinds = manageableCatalogKinds(access.permissions);
  const [firstKind] = kinds;
  if (!firstKind) return <PermissionDenied description={t("deniedDescription")} />;

  const requested = firstParam((await searchParams).kind);
  const kind = kinds.find((candidate) => candidate === requested) ?? firstKind;
  const items = await listCatalogItems(member.organization.id, kind);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <nav aria-label={t("kindsLabel")} className="flex flex-wrap gap-2">
        {kinds.map((candidate) => (
          <Link
            key={candidate}
            href={`/settings/catalogs?kind=${candidate}`}
            aria-current={candidate === kind ? "page" : undefined}
            className={cn(buttonVariants({ variant: candidate === kind ? "default" : "outline" }))}
          >
            {t(`kinds.${candidate}`)}
          </Link>
        ))}
      </nav>
      <CatalogList kind={kind} items={items} />
    </>
  );
}
