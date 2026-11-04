"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { showSplash } from "@/components/shared/splash-host";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInAction } from "@/modules/auth/actions";
import { signInFormSchema, type SignInError, type SignInFormValues } from "@/modules/auth/schemas";

export function LoginForm() {
  const t = useTranslations("auth.login");
  const [serverError, setServerError] = useState<SignInError | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const form = useForm<SignInFormValues>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await signInAction(values);
      if (result.error === null) {
        // Signed in: the Zcore loader stays until the app has rendered.
        showSplash(pathname);
        router.replace(result.to);
        return;
      }
      setServerError(result.error);
      form.resetField("password");
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {serverError ? (
          <Alert variant="destructive">
            <AlertDescription>{t(`errors.${serverError}`)}</AlertDescription>
          </Alert>
        ) : null}

        <Controller
          name="username"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="username">{t("username")}</FieldLabel>
              <Input
                {...field}
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-12 text-base"
                aria-invalid={
                  fieldState.invalid || serverError === "invalid_credentials" || undefined
                }
              />
              {fieldState.invalid ? <FieldError>{t("usernameRequired")}</FieldError> : null}
            </Field>
          )}
        />

        <Controller
          name="password"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid || undefined}>
              <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
              <Input
                {...field}
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-12 text-base"
                aria-invalid={
                  fieldState.invalid || serverError === "invalid_credentials" || undefined
                }
              />
              {fieldState.invalid ? <FieldError>{t("passwordRequired")}</FieldError> : null}
            </Field>
          )}
        />

        <Field>
          <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
