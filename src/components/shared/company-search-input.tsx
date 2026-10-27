"use client";

import { BuildingIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { countryName } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { searchCompaniesAction, type CompanySuggestion } from "@/modules/companies/actions";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

/**
 * Text input with suggestions from the shared company directory (combobox
 * pattern). Suggestions appear only after three characters (the directory is
 * not browsable); picking one calls `onPick`, typing on keeps free text.
 */
export function CompanySearchInput({
  value,
  onChange,
  onPick,
  disabled,
  className,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  onPick: (suggestion: CompanySuggestion) => void;
}) {
  const t = useTranslations("companySearch");
  const listId = useId();
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const requestId = useRef(0);

  useEffect(() => {
    const query = value.trim();
    if (disabled || query.length < MIN_CHARS) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const found = await searchCompaniesAction(query);
      // Ignore answers to older keystrokes.
      if (id === requestId.current) {
        setSuggestions(found);
        setActive(-1);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, disabled]);

  const visible = open && value.trim().length >= MIN_CHARS && suggestions.length > 0;

  const pick = (suggestion: CompanySuggestion) => {
    setOpen(false);
    onPick(suggestion);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={className}
        onChange={(event) => {
          onChange(event.target.value);
          if (event.target.value.trim().length < MIN_CHARS) setSuggestions([]);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!visible) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            const suggestion = suggestions[active];
            if (suggestion) pick(suggestion);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {visible ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("label")}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm",
                index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
              )}
              // mousedown: before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
            >
              <BuildingIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{suggestion.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[suggestion.city, countryName(suggestion.country), suggestion.taxId]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
