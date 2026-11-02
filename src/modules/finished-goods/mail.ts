// Links that open a new e-mail with the recipient, subject and text filled
// in (D-040). Attachments cannot be passed this way; the PDF is downloaded
// next to it, or attached by the device's share sheet.

export type MailDraft = { to: string | null; subject: string; body: string };

export type MailTarget = "gmail" | "outlook" | "outlook_work" | "mail_app";

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

export function mailLink(target: MailTarget, draft: MailDraft): string {
  const to = draft.to ?? "";
  switch (target) {
    case "gmail":
      return `https://mail.google.com/mail/?view=cm&fs=1&${query({ to, su: draft.subject, body: draft.body })}`;
    case "outlook":
      return `https://outlook.live.com/mail/0/deeplink/compose?${query({ to, subject: draft.subject, body: draft.body })}`;
    case "outlook_work":
      return `https://outlook.office.com/mail/deeplink/compose?${query({ to, subject: draft.subject, body: draft.body })}`;
    case "mail_app":
      return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${query({ subject: draft.subject, body: draft.body })}`;
  }
}
