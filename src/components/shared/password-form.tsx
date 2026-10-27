"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ComponentProps } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { changeInitialPasswordAction, changeOwnPasswordAction } from "@/modules/profile/actions";
import {
  changePasswordSchema,
  initialPasswordSchema,
  passwordStrength,
  type ChangePasswordValues,
  type PasswordError,
  type PasswordField,
} from "@/modules/profile/schemas";

/** Password input with a show/hide button (large on phones). */
export function PasswordInput({ className, ...props }: ComponentProps<"input">) {
  const t = useTranslations("passwordForm");
  const [visible, setVisible] = useState(false);
  return (
    <InputGroup className={cn("h-12", className)}>
      <InputGroupInput
        {...props}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="text-base"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-sm"
          aria-label={visible ? t("hide") : t("show")}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

const STRENGTH_TONES = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-emerald-500"] as const;

function StrengthMeter({ password }: { password: string }) {
  const t = useTranslations("passwordForm.strength");
  if (password === "") return null;
  const strength = passwordStrength(password);
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              strength >= step ? STRENGTH_TONES[strength] : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        {t(String(strength) as "0" | "1" | "2" | "3")}
      </span>
    </div>
  );
}

/**
 * mode "initial": first sign-in with a temporary password (no current
 * password; redirects home on success). mode "change": profile page.
 */
export function PasswordForm({ mode, username }: { mode: "initial" | "change"; username: string }) {
  const t = useTranslations("passwordForm");
  const [formError, setFormError] = useState<PasswordError | null>(null);
  const [pending, startTransition] = useTransition();
  const schema =
    mode === "initial" ? initialPasswordSchema(username) : changePasswordSchema(username);
  const empty: ChangePasswordValues = { currentPassword: "", newPassword: "", confirmPassword: "" };
  const form = useForm<ChangePasswordValues>({
    // The initial schema ignores currentPassword.
    resolver: zodResolver(schema as ReturnType<typeof changePasswordSchema>),
    defaultValues: empty,
  });
  const newPassword = useWatch({ control: form.control, name: "newPassword" });

  const onSubmit = form.handleSubmit(() => {
    setFormError(null);
    startTransition(async () => {
      const values = form.getValues();
      // "initial" redirects on success and only returns on failure.
      const result =
        mode === "initial"
          ? await changeInitialPasswordAction(values)
          : await changeOwnPasswordAction(values);
      if (result.ok) {
        toast.success(t("success"));
        form.reset(empty);
        return;
      }
      const fieldErrors: Partial<Record<PasswordError, PasswordField>> = {
        wrong_current: "currentPassword",
        same_password: "newPassword",
        weak_password: "newPassword",
      };
      const field = fieldErrors[result.error];
      if (field) {
        form.setError(field, { type: "server", message: t(`errors.${result.error}`) });
      } else if (result.error === "invalid" && result.fields.length > 0) {
        for (const name of result.fields) form.setError(name, { type: "server" });
      } else {
        setFormError(result.error);
      }
    });
  });

  const messageFor = (
    error: { type?: string; message?: string } | undefined,
    name: PasswordField,
  ) => {
    if (error?.type === "server" && error.message) return error.message;
    if (error?.message === "username") return t("fieldErrors.notUsername");
    if (error?.message === "same") return t("fieldErrors.sameAsCurrent");
    return t(`fieldErrors.${name}`);
  };

  const field = (name: PasswordField, autoComplete: string, hint?: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field: input, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined}>
          <FieldLabel htmlFor={`password-${name}`}>{t(name)}</FieldLabel>
          <PasswordInput
            {...input}
            id={`password-${name}`}
            autoComplete={autoComplete}
            aria-invalid={fieldState.invalid || undefined}
          />
          {name === "newPassword" ? <StrengthMeter password={newPassword} /> : null}
          {fieldState.invalid ? (
            <FieldError>{messageFor(fieldState.error, name)}</FieldError>
          ) : hint ? (
            <FieldDescription>{hint}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{t(`errors.${formError}`)}</AlertDescription>
          </Alert>
        ) : null}
        {mode === "change" ? field("currentPassword", "current-password") : null}
        {field("newPassword", "new-password", t("newPasswordHint"))}
        {field("confirmPassword", "new-password")}
        <Field>
          <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
            {pending ? t("submitting") : mode === "initial" ? t("submitInitial") : t("submit")}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
