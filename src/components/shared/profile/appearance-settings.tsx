"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { updatePreferencesAction } from "@/modules/profile/actions";
import { TEXT_SIZES, type TextSize } from "@/modules/profile/schemas";

const THEMES = [
  { value: "light", icon: SunIcon },
  { value: "dark", icon: MoonIcon },
  { value: "system", icon: MonitorIcon },
] as const;

/** Theme (this device, next-themes) and text size (the user's profile). */
export function AppearanceSettings({ textSize }: { textSize: TextSize }) {
  const t = useTranslations("profile.appearance");
  const tTheme = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  const [pending, startTransition] = useTransition();
  const [size, setOptimisticSize] = useOptimistic(textSize);

  const chooseSize = (next: TextSize) =>
    startTransition(async () => {
      setOptimisticSize(next);
      const result = await updatePreferencesAction({ textSize: next });
      if (!result.ok) toast.error(t("saveFailed"));
    });

  return (
    <FieldGroup>
      <Field>
        <FieldLabel id="appearance-theme">{t("theme")}</FieldLabel>
        <div
          role="radiogroup"
          aria-labelledby="appearance-theme"
          className="grid grid-cols-3 gap-2"
        >
          {THEMES.map(({ value, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              role="radio"
              aria-checked={(theme ?? "system") === value}
              variant={(theme ?? "system") === value ? "default" : "outline"}
              className="h-12"
              onClick={() => setTheme(value)}
            >
              <Icon />
              {tTheme(value)}
            </Button>
          ))}
        </div>
        <FieldDescription>{t("themeHint")}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel id="appearance-text-size">{t("textSize")}</FieldLabel>
        <div
          role="radiogroup"
          aria-labelledby="appearance-text-size"
          className="grid grid-cols-2 gap-2"
        >
          {TEXT_SIZES.map((value) => (
            <Button
              key={value}
              type="button"
              role="radio"
              aria-checked={size === value}
              variant={size === value ? "default" : "outline"}
              className="h-12"
              disabled={pending}
              onClick={() => chooseSize(value)}
            >
              <span className={value === "large" ? "text-lg" : undefined}>
                {t(`textSizes.${value}`)}
              </span>
            </Button>
          ))}
        </div>
        <FieldDescription>{t("textSizeHint")}</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
