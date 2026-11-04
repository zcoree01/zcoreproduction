"use client";

import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Chrome's install prompt (not in the DOM typings).
type InstallPromptEvent = Event & { prompt: () => Promise<void> };

/**
 * Installing the kiosk as an app (D-048): the button appears when Chrome
 * offers installation; the hints explain the menu fallback and screen
 * pinning, which keeps workers inside the kiosk. Hidden in the installed app.
 */
export function InstallApp() {
  const t = useTranslations("kiosk");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)");
    const sync = () => setInstalled(standalone.matches);
    const offer = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const done = () => setPrompt(null);
    sync();
    standalone.addEventListener("change", sync);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", done);
    return () => {
      standalone.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <h2 className="font-semibold">{t("installTitle")}</h2>
      {prompt ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12"
          onClick={() => {
            void prompt.prompt().finally(() => setPrompt(null));
          }}
        >
          <DownloadIcon />
          {t("installApp")}
        </Button>
      ) : null}
      <p className="text-muted-foreground">{t("installHint")}</p>
      <p className="text-muted-foreground">{t("lockHint")}</p>
    </section>
  );
}
