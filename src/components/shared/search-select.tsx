"use client";

import { useTranslations } from "next-intl";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { matchesAllWords } from "@/lib/search";

export type SearchSelectOption = {
  value: string;
  label: string;
  /** Secondary text shown and searched (e.g. the material group). */
  hint?: string;
};

/**
 * Select with type-to-search (e.g. "inox 304"). Value "" means nothing
 * selected, like the native selects in forms.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("searchSelect");
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(next) => onChange(next?.value ?? "")}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      filter={(option, query) => matchesAllWords(`${option.label} ${option.hint ?? ""}`, query)}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder={placeholder}
        showClear={selected !== null}
        aria-invalid={invalid || undefined}
        disabled={disabled}
      />
      <ComboboxContent>
        <ComboboxEmpty>{t("empty")}</ComboboxEmpty>
        <ComboboxList>
          {(option: SearchSelectOption) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.hint ? (
                  <span className="truncate text-xs text-muted-foreground">{option.hint}</span>
                ) : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
