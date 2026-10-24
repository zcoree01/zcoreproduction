"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  Controller,
  useForm,
  type FieldPath,
  type FieldError as FormFieldError,
} from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { createUserAction } from "@/modules/users/actions";
import {
  createUserSchema,
  type CreateUserError,
  type CreateUserFormValues,
} from "@/modules/users/schemas";

const EMPTY: CreateUserFormValues = { username: "", fullName: "", roleId: "", password: "" };

export function CreateUserSheet({ roles }: { roles: { id: string; label: string }[] }) {
  const t = useTranslations("users.form");
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<CreateUserError | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: EMPTY,
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await createUserAction(values);
      if (result.ok) {
        toast.success(t("success", { username: result.username }));
        form.reset(EMPTY);
        setOpen(false);
        return;
      }
      // Field-level problems go next to the field; the rest above the form.
      if (result.error === "username_taken") {
        form.setError("username", { type: "server", message: t("errors.username_taken") });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const field of result.fields) form.setError(field, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  // Server messages win; otherwise a Bosnian message per field.
  const errorFor = (name: FieldPath<CreateUserFormValues>, error: FormFieldError | undefined) =>
    error?.type === "server" && error.message ? error.message : t(`fieldErrors.${name}`);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormError(null);
      }}
    >
      <SheetTrigger render={<Button />}>
        <PlusIcon />
        {t("open")}
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <form
          id="create-user-form"
          onSubmit={onSubmit}
          noValidate
          className="flex-1 overflow-y-auto p-4"
        >
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
              </Alert>
            ) : null}

            <Controller
              name="username"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-username">{t("username")}</FieldLabel>
                  <Input
                    {...field}
                    id="new-username"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? (
                    <FieldError>{errorFor("username", fieldState.error)}</FieldError>
                  ) : (
                    <FieldDescription>{t("usernameHint")}</FieldDescription>
                  )}
                </Field>
              )}
            />

            <Controller
              name="fullName"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-fullName">{t("fullName")}</FieldLabel>
                  <Input
                    {...field}
                    id="new-fullName"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? <FieldError>{t("fieldErrors.fullName")}</FieldError> : null}
                </Field>
              )}
            />

            <Controller
              name="roleId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-roleId">{t("role")}</FieldLabel>
                  <NativeSelect
                    {...field}
                    id="new-roleId"
                    className="w-full"
                    aria-invalid={fieldState.invalid || undefined}
                  >
                    <NativeSelectOption value="" disabled>
                      {t("rolePlaceholder")}
                    </NativeSelectOption>
                    {roles.map((role) => (
                      <NativeSelectOption key={role.id} value={role.id}>
                        {role.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {fieldState.invalid ? <FieldError>{t("fieldErrors.roleId")}</FieldError> : null}
                </Field>
              )}
            />

            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="new-password">{t("password")}</FieldLabel>
                  <Input
                    {...field}
                    id="new-password"
                    type="text"
                    autoComplete="new-password"
                    spellCheck={false}
                    aria-invalid={fieldState.invalid || undefined}
                  />
                  {fieldState.invalid ? (
                    <FieldError>{t("fieldErrors.password")}</FieldError>
                  ) : (
                    <FieldDescription>{t("passwordHint")}</FieldDescription>
                  )}
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <SheetFooter className="border-t">
          <Button type="submit" form="create-user-form" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
