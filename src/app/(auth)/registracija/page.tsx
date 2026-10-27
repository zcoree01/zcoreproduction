import { FactoryIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { RegistrationWizard } from "./registration-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("registration");
  return { title: t("title") };
}

/** Public company registration (D-026): six steps, then the login of the new company. */
export default async function RegistrationPage() {
  const [t, tCommon] = await Promise.all([
    getTranslations("registration"),
    getTranslations("common"),
  ]);
  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-muted px-4 py-8 md:p-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FactoryIcon className="size-4" />
          </div>
          {tCommon("appName")}
        </div>
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <RegistrationWizard />
        <p className="text-center text-sm text-muted-foreground">
          {t("haveAccount")}{" "}
          <Link href="/login" className="underline underline-offset-4">
            {t("toLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
