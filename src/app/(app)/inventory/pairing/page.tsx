import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { listPairingRevisions, listStockItemOptions } from "@/modules/inventory/queries";
import { pairingCandidates } from "@/modules/inventory/rules";
import { PairingList } from "./pairing-list";

export default function PairingPage() {
  return (
    <PageSuspense>
      <PairingContent />
    </PageSuspense>
  );
}

async function PairingContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("inventory"), getMemberAccess(member)]);

  if (!access.modules.has("inventory") || !access.modules.has("production")) {
    return <ModuleDisabled />;
  }
  if (!access.permissions.has("products.manage")) {
    return <PermissionDenied description={t("pairing.deniedDescription")} />;
  }

  const [revisions, items] = await Promise.all([
    listPairingRevisions(organizationId),
    listStockItemOptions(organizationId),
  ]);
  const rows = revisions.map((revision) => ({
    ...revision,
    candidateIds: pairingCandidates(revision, items).map((item) => item.id),
  }));

  return (
    <>
      <PageHeader title={t("pairing.title")} description={t("pairing.description")} />
      <PairingList rows={rows} items={items} />
    </>
  );
}
