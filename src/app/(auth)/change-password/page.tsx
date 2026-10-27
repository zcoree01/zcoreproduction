import { FactoryIcon, LogOutIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { PasswordForm } from "@/components/shared/password-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { homePathFor } from "@/lib/auth/home";
import { requireMember } from "@/lib/auth/session";
import { signOutAction } from "@/modules/auth/actions";

// First sign-in with a temporary password; the proxy keeps the user here
// until they choose their own (D-022). Same frame as the login screen.
export default async function ChangePasswordPage() {
  const t = await getTranslations("common");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FactoryIcon className="size-4" />
          </div>
          {t("appName")}
        </div>
        <Suspense fallback={<PageSkeleton label={t("loading")} />}>
          <ChangePasswordCard />
        </Suspense>
      </div>
    </div>
  );
}

async function ChangePasswordCard() {
  const member = await requireMember();
  if (!member.mustChangePassword) redirect(homePathFor(member.role.key));
  const t = await getTranslations();

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          <h1>{t("changePassword.title")}</h1>
        </CardTitle>
        <CardDescription>
          {t("changePassword.description", { name: member.fullName ?? member.username })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PasswordForm mode="initial" username={member.username} />
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" className="h-12 w-full text-base">
            <LogOutIcon />
            {t("common.signOut")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
