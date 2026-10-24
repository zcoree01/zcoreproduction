import { PackageXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "./empty-state";

// Shown when a screen belongs to a module that is not enabled for the
// organization (commercial activation, see org_modules).
export async function ModuleDisabled() {
  const t = await getTranslations("moduleDisabled");
  return <EmptyState icon={<PackageXIcon />} title={t("title")} description={t("description")} />;
}
