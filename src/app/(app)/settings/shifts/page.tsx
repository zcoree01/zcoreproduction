import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { getAttendanceRules, listShifts } from "@/modules/attendance/queries";
import { AttendanceRulesForm } from "./attendance-rules-form";
import { ShiftList } from "./shift-list";

export default function ShiftSettingsPage() {
  return (
    <PageSuspense>
      <ShiftSettingsContent />
    </PageSuspense>
  );
}

async function ShiftSettingsContent() {
  const member = await requireMember();
  const [t, access] = await Promise.all([getTranslations("shifts"), getMemberAccess(member)]);

  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("shifts.manage")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const [shifts, rules] = await Promise.all([
    listShifts(member.organization.id),
    getAttendanceRules(member.organization.id),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ShiftList items={shifts} />
      <AttendanceRulesForm rules={rules} />
    </>
  );
}
