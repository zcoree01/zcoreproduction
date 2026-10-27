import { getTranslations } from "next-intl/server";
import { ModuleDisabled } from "@/components/shared/module-disabled";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { PermissionDenied } from "@/components/shared/permission-denied";
import { getMemberAccess } from "@/lib/auth/access";
import { requireMember } from "@/lib/auth/session";
import { zonedDate } from "@/lib/timezone";
import { listShifts } from "@/modules/attendance/queries";
import {
  listCrews,
  listRotationAssignments,
  listRotations,
  listScheduleEmployees,
} from "@/modules/attendance/schedule-queries";
import { AssignmentsPanel } from "./assignments-panel";
import { CrewsPanel } from "./crews-panel";
import { RotationsPanel } from "./rotations-panel";

// Crews (ekipe), rotations (repeating shift patterns) and who follows which
// rotation from when. The schedule grid writes rotations into the calendar.

export default function CrewsPage() {
  return (
    <PageSuspense>
      <CrewsContent />
    </PageSuspense>
  );
}

async function CrewsContent() {
  const member = await requireMember();
  const organizationId = member.organization.id;
  const [t, access] = await Promise.all([getTranslations("crews"), getMemberAccess(member)]);
  if (!access.modules.has("attendance")) return <ModuleDisabled />;
  if (!access.permissions.has("attendance.read")) {
    return <PermissionDenied description={t("deniedDescription")} />;
  }

  const [crews, rotations, assignments, employees, shifts] = await Promise.all([
    listCrews(organizationId),
    listRotations(organizationId),
    listRotationAssignments(organizationId),
    listScheduleEmployees(organizationId),
    listShifts(organizationId),
  ]);
  const canManage = access.permissions.has("attendance.manage");
  const shiftOptions = shifts
    .filter((shift) => shift.archivedAt === null)
    .map((shift) => ({
      id: shift.id,
      code: shift.code,
      name: shift.name,
      color: shift.color,
    }));
  const today = zonedDate(new Date(), member.organization.timezone);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <CrewsPanel crews={crews} employees={employees} canManage={canManage} />
      <RotationsPanel rotations={rotations} shifts={shiftOptions} canManage={canManage} />
      <AssignmentsPanel
        assignments={assignments}
        rotations={rotations.filter((rotation) => !rotation.archived)}
        allRotations={rotations}
        crews={crews}
        employees={employees}
        canManage={canManage}
        today={today}
      />
    </>
  );
}
