import type { Metadata } from "next";
import { Suspense } from "react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { MESSAGE_SCOPES, pickMessages } from "@/i18n/message-scopes";
import { SplashHost } from "@/components/shared/splash-host";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// latin-ext is required for č, ć, đ, š, ž.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
});

// The loader's lettering, as on www.zcore.ba.
const zcoreMono = JetBrains_Mono({
  variable: "--font-zcore-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    // next-themes sets the theme class before hydration.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${zcoreMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Only the root scope here; each route group provides its own
              messages (i18n/message-scopes), so worker and sign-in screens
              do not download the whole translation file. */}
          <NextIntlClientProvider messages={pickMessages(messages, MESSAGE_SCOPES.root)}>
            <TooltipProvider>{children}</TooltipProvider>
            {/* Reads the pathname: needs its own Suspense boundary (prerendering). */}
            <Suspense fallback={null}>
              <SplashHost />
            </Suspense>
            <Toaster position="top-center" />
          </NextIntlClientProvider>
          {/* Real-user Web Vitals (Vercel Speed Insights); reads the route, so
              it gets its own Suspense boundary like SplashHost. */}
          <Suspense fallback={null}>
            <SpeedInsights />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
