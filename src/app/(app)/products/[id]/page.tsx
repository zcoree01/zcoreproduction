import { ArrowLeftIcon, PackageXIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import type { SearchParamsRecord } from "@/lib/data-table/params";
import { cn } from "@/lib/utils";
import { listCatalogOptions } from "@/modules/catalogs/queries";
import { parseProductDetailParams } from "@/modules/products/list-params";
import {
  getDefaultCycleUnit,
  getProduct,
  getProductHistory,
  getRevision,
  listAttachments,
  listMachineChoices,
  listOperations,
  listOperationTypes,
} from "@/modules/products/queries";
import { nextRevisionLabel } from "@/modules/products/rules";
import { AttachmentsPanel } from "./attachments-panel";
import { BasicPanel } from "./basic-panel";
import { HistoryPanel } from "./history-panel";
import { OperationsPanel } from "./operations-panel";
import { ProductActions, RevisionPicker, SetCurrentRevisionButton } from "./product-actions";
import { ProductTabs } from "./product-tabs";

export default function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  return (
    <PageSuspense>
      <ProductContent params={params} searchParams={searchParams} />
    </PageSuspense>
  );
}

async function ProductContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, format, access] = await Promise.all([
    getTranslations("products"),
    getFormatter(),
    getMemberAccess(member),
  ]);

  if (!access.modules.has("production")) return <ModuleDisabled />;
  if (!access.permissions.has("products.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const { id } = await params;
  const detailParams = parseProductDetailParams(await searchParams);
  const productId = z.uuid().safeParse(id);
  const product = productId.success ? await getProduct(organizationId, productId.data) : null;
  const current = product?.revisions.find((revision) => revision.isCurrent) ?? null;
  const selected =
    product?.revisions.find((revision) => revision.id === detailParams.revisionId) ?? current;

  if (!product || !selected) {
    return (
      <EmptyState
        icon={<PackageXIcon />}
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundDescription")}
        action={
          <Link href="/products" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("detail.back")}
          </Link>
        }
      />
    );
  }

  const canManage = access.permissions.has("products.manage");
  const editable = canManage && !product.archived && selected.isCurrent;
  const [
    revision,
    operations,
    attachments,
    history,
    catalogs,
    operationTypes,
    machines,
    cycleUnit,
  ] = await Promise.all([
    getRevision(organizationId, selected.id),
    listOperations(organizationId, selected.id),
    listAttachments(organizationId, selected.id),
    getProductHistory(product.id),
    listCatalogOptions(organizationId, ["product_type", "material_shape", "machine_type"]),
    listOperationTypes(organizationId, { includeArchived: true }),
    editable ? listMachineChoices(organizationId) : Promise.resolve([]),
    getDefaultCycleUnit(organizationId),
  ]);
  if (!revision) throw new Error(`Revision ${selected.id} not readable`);

  const labels = product.revisions.map((r) => r.revision);
  const suggestedRevision = nextRevisionLabel(current?.revision ?? revision.revision, labels) ?? "";

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link
          href="/products"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("detail.back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">
                {product.partNumber}
              </h1>
              <Badge variant={selected.isCurrent ? "default" : "outline"}>
                {t("detail.revisionBadge", { revision: selected.revision })}
              </Badge>
              {product.archived ? <Badge variant="secondary">{t("detail.archived")}</Badge> : null}
            </div>
            <p className="text-lg">{product.name}</p>
            {product.customerName ? (
              <p className="text-sm text-muted-foreground">
                {t("detail.customer", { customer: product.customerName })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RevisionPicker
              productId={product.id}
              revisions={product.revisions}
              selectedId={selected.id}
            />
            {canManage ? (
              <ProductActions
                product={product}
                revision={revision}
                editable={editable}
                suggestedRevision={suggestedRevision}
                catalogs={{ types: catalogs.product_type, shapes: catalogs.material_shape }}
              />
            ) : null}
          </div>
        </div>
      </div>

      {!selected.isCurrent ? (
        <Alert>
          <AlertTitle>{t("detail.oldRevisionTitle", { revision: selected.revision })}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("detail.oldRevisionDescription", { current: current?.revision ?? "—" })}</span>
            {canManage && !product.archived ? (
              <SetCurrentRevisionButton revisionId={selected.id} revision={selected.revision} />
            ) : null}
          </AlertDescription>
        </Alert>
      ) : product.archived ? (
        <Alert>
          <AlertDescription>{t("detail.archivedDescription")}</AlertDescription>
        </Alert>
      ) : null}

      <ProductTabs
        initialTab={detailParams.tab}
        counts={{
          operations: operations.filter((op) => !op.archived).length,
          attachments: attachments.filter((a) => !a.archived).length,
        }}
        basic={<BasicPanel product={product} revision={revision} />}
        operations={
          <OperationsPanel
            revisionId={revision.id}
            operations={operations}
            operationTypes={operationTypes}
            machineTypes={catalogs.machine_type}
            machines={machines}
            defaultUnit={cycleUnit}
            editable={editable}
          />
        }
        attachments={
          <AttachmentsPanel
            revisionId={revision.id}
            attachments={attachments}
            operations={operations.filter((op) => !op.archived)}
            editable={editable}
          />
        }
        history={
          <HistoryPanel
            revisions={product.revisions.map((r) => ({
              ...r,
              createdLabel: format.dateTime(new Date(r.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: member.organization.timezone,
              }),
            }))}
            entries={history.map((entry) => ({
              ...entry,
              createdLabel: format.dateTime(new Date(entry.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: member.organization.timezone,
              }),
            }))}
            productId={product.id}
            canRestore={canManage && !product.archived}
          />
        }
      />
    </>
  );
}
