import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { MESSAGE_SCOPES, pickMessages, type MessageScope } from "@/i18n/message-scopes";

/**
 * Client messages for one route group (see i18n/message-scopes). Without a
 * scope, every message: for the management app and print pages.
 */
export async function ScopedIntlProvider({
  scope,
  children,
}: {
  scope?: MessageScope;
  children: ReactNode;
}) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider
      messages={scope ? pickMessages(messages, MESSAGE_SCOPES[scope]) : messages}
    >
      {children}
    </NextIntlClientProvider>
  );
}
