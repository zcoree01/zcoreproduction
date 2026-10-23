"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createUserAction } from "@/modules/users/actions";
import type { CreateUserField, CreateUserFormState } from "@/modules/users/schemas";

const INITIAL_STATE: CreateUserFormState = { status: "idle" };

export function CreateUserForm({ roles }: { roles: { id: string; label: string }[] }) {
  const t = useTranslations("users.form");
  const [state, formAction, pending] = useActionState(createUserAction, INITIAL_STATE);

  // React resets the form after each submission; on error the values come back
  // through defaultValue so the admin does not retype them (password excepted).
  const values = state.status === "error" ? state.values : undefined;
  const invalid = (field: CreateUserField) =>
    state.status === "error" && state.invalidFields.includes(field);
  const fieldError = (field: CreateUserField) =>
    invalid(field) ? (
      <p id={`${field}-error`} className="text-sm text-destructive">
        {t(`fieldErrors.${field}`)}
      </p>
    ) : null;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.status === "success" ? (
        <Alert role="status">
          <AlertDescription>{t("success", { username: state.username })}</AlertDescription>
        </Alert>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="username">{t("username")}</Label>
        <Input
          id="username"
          name="username"
          defaultValue={values?.username}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={invalid("username") || undefined}
          aria-describedby={invalid("username") ? "username-error" : "username-hint"}
        />
        {fieldError("username") ?? (
          <p id="username-hint" className="text-xs text-muted-foreground">
            {t("usernameHint")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={values?.fullName}
          autoComplete="off"
          aria-invalid={invalid("fullName") || undefined}
          aria-describedby={invalid("fullName") ? "fullName-error" : undefined}
        />
        {fieldError("fullName")}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="roleId">{t("role")}</Label>
        <NativeSelect
          id="roleId"
          name="roleId"
          className="w-full"
          defaultValue={values?.roleId ?? ""}
          aria-invalid={invalid("roleId") || undefined}
          aria-describedby={invalid("roleId") ? "roleId-error" : undefined}
        >
          <option value="" disabled>
            {t("rolePlaceholder")}
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </NativeSelect>
        {fieldError("roleId")}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={invalid("password") || undefined}
          aria-describedby={invalid("password") ? "password-error" : "password-hint"}
        />
        {fieldError("password") ?? (
          <p id="password-hint" className="text-xs text-muted-foreground">
            {t("passwordHint")}
          </p>
        )}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
