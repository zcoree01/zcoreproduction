import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginOrganizationName } from "@/modules/auth/queries";
import { getTenantSlug } from "@/lib/tenant/server";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<LoginFallback />}>
          <LoginCard />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginFallback() {
  const t = await getTranslations("common");
  return <PageSkeleton label={t("loading")} />;
}

async function LoginCard() {
  const t = await getTranslations("auth.login");
  const appName = (await getTranslations("common"))("appName");
  const slug = await getTenantSlug();
  const organizationName = slug ? await getLoginOrganizationName(slug) : null;

  if (!slug || !organizationName) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>{appName}</CardDescription>
          <CardTitle>{t(slug ? "unknownTenantTitle" : "noTenantTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t(slug ? "unknownTenantDescription" : "noTenantDescription")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>{organizationName}</CardDescription>
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
