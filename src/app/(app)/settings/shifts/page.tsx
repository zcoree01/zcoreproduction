import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { getLeaveRules } from "@/modules/attendance/absence-queries";
import { getCalcSettings, getDefaultRate } from "@/modules/attendance/payroll-queries";
import { getAttendanceRules, listShifts } from "@/modules/attendance/queries";
import { AttendanceRulesForm } from "./attendance-rules-form";
import { LeaveRulesForm } from "./leave-rules-form";
import { CalcRulesForm, PaySettingsForm } from "./pay-forms";
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
  // Shifts and rules: shifts.manage; premiums and the hourly rate: payroll.manage (HR).
  const canShifts = access.permissions.has("shifts.manage");
  const canPay = access.permissions.has("payroll.manage");
  if (!canShifts && !canPay) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const [shifts, rules, leaveRules, calc, defaultRate] = await Promise.all([
    listShifts(member.organization.id),
    getAttendanceRules(member.organization.id),
    getLeaveRules(member.organization.id),
    getCalcSettings(member.organization.id),
    canPay ? getDefaultRate(member.organization.id) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {canShifts ? (
        <>
          <ShiftList items={shifts} />
          <AttendanceRulesForm rules={rules} />
          <CalcRulesForm settings={calc} />
        </>
      ) : null}
      {canPay ? (
        <PaySettingsForm
          values={{
            overtimePct: calc.overtimePct,
            nightPct: calc.nightPct,
            weekendPct: calc.weekendPct,
            holidayPct: calc.holidayPct,
            defaultHourlyRate: defaultRate ?? "",
          }}
        />
      ) : null}
      {canShifts ? <LeaveRulesForm rules={leaveRules} /> : null}
    </>
  );
}
