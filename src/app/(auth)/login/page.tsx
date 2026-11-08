import { FactoryIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/page-skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SESSION_REPLACED_PARAM } from "@/lib/auth/route-guard";
import { firstParam, type SearchParamsRecord } from "@/lib/data-table/params";
import { getTenantSlug } from "@/lib/tenant/server";
import { getLoginOrganizationName } from "@/modules/auth/queries";
import { PLATFORM_SLUG } from "@/modules/support/schemas";
import { LoginForm } from "./login-form";

// Layout from the shadcn login-03 block.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
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
          <LoginCard searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={null}>
          <RegisterLink />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * "Nova firma? Registrujte firmu" only where no company is chosen yet
 * (prijava.zcore.ba/login); a company's own sign-in page does not offer it.
 */
async function RegisterLink() {
  const [slug, t] = await Promise.all([getTenantSlug(), getTranslations("common")]);
  if (slug) return null;
  return (
    <p className="text-center text-sm text-muted-foreground">
      {t("newCompany")}{" "}
      <Link href="/registracija" className="underline underline-offset-4">
        {t("register")}
      </Link>
    </p>
  );
}

async function LoginCard({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const t = await getTranslations("auth.login");
  // Set by the proxy when this device was signed out by a newer sign-in.
  const replaced =
    firstParam((await searchParams)[SESSION_REPLACED_PARAM.name]) === SESSION_REPLACED_PARAM.value;
  const slug = await getTenantSlug();
  const organizationName = slug ? await getLoginOrganizationName(slug) : null;

  if (slug && !organizationName) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{t("unknownTenantTitle")}</CardTitle>
          <CardDescription>{t("unknownTenantDescription")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!slug || !organizationName) {
    // No company in the address (prijava.zcore.ba): ask for it (D-047).
    const params = await searchParams;
    const unknown = firstParam(params.firma) === "nepoznata";
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            <h1>{t("noTenantTitle")}</h1>
          </CardTitle>
          <CardDescription>{t("noTenantDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/login/firma" className="flex flex-col gap-4">
            {unknown ? (
              <Alert variant="destructive">
                <AlertDescription>{t("companyUnknown")}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="company-address">{t("companyAddress")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="company-address"
                  name="adresa"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  defaultValue={firstParam(params.adresa) ?? ""}
                  placeholder={t("companyPlaceholder")}
                />
                <span className="shrink-0 font-mono text-sm text-muted-foreground">.zcore.ba</span>
              </div>
            </div>
            <Button type="submit" className="w-full">
              {t("companyContinue")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">
          <h1>{t("title")}</h1>
        </CardTitle>
        <CardDescription>{organizationName}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {replaced ? (
          <Alert>
            <AlertDescription>{t("sessionReplaced")}</AlertDescription>
          </Alert>
        ) : null}
        <LoginForm />
        {/* Zcore admins reset their passwords themselves; the hint is for companies. */}
        {slug === PLATFORM_SLUG ? null : (
          <p className="text-center text-sm text-muted-foreground">{t("forgotPassword")}</p>
        )}
      </CardContent>
    </Card>
  );
}
