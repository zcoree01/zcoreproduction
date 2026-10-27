import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { PageSuspense } from "@/components/shared/page-suspense";
import { ProfileView } from "@/components/shared/profile/profile-view";
import { requireMember } from "@/lib/auth/session";

export default function FloorProfilePage() {
  return (
    <PageSuspense>
      <ProfileContent />
    </PageSuspense>
  );
}

async function ProfileContent() {
  const [member, t] = await Promise.all([requireMember(), getTranslations("profile")]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ProfileView member={member} />
    </>
  );
}
