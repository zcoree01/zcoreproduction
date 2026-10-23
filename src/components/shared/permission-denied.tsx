import { ShieldAlertIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "./empty-state";

// Shown when the member lacks the permission for a whole screen.
export async function PermissionDenied({ description }: { description?: string }) {
  const t = await getTranslations("permissionDenied");
  return (
    <EmptyState
      icon={<ShieldAlertIcon />}
      title={t("title")}
      description={description ?? t("description")}
    />
  );
}
