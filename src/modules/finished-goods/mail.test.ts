import { describe, expect, it } from "vitest";
import { mailLink } from "./mail";

const draft = {
  to: "nabava@kupac.ba",
  subject: "Otpremnica 03-1126-122",
  body: "Poštovani,\nu prilogu je otpremnica.",
};

describe("mail links", () => {
  it("opens Gmail with recipient, subject and text", () => {
    const url = new URL(mailLink("gmail", draft));
    expect(url.origin).toBe("https://mail.google.com");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("to")).toBe("nabava@kupac.ba");
    expect(url.searchParams.get("su")).toBe("Otpremnica 03-1126-122");
    expect(url.searchParams.get("body")).toBe("Poštovani,\nu prilogu je otpremnica.");
  });

  it("opens Outlook (personal and work) and the mail program", () => {
    expect(new URL(mailLink("outlook", draft)).searchParams.get("subject")).toBe(
      "Otpremnica 03-1126-122",
    );
    expect(mailLink("outlook_work", draft)).toMatch(
      /^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?to=nabava%40kupac\.ba&/,
    );
    expect(mailLink("mail_app", draft)).toBe(
      "mailto:nabava@kupac.ba?subject=Otpremnica%2003-1126-122&body=Po%C5%A1tovani%2C%0Au%20prilogu%20je%20otpremnica.",
    );
  });

  it("leaves the recipient empty when the customer has no e-mail", () => {
    const url = new URL(mailLink("gmail", { ...draft, to: null }));
    expect(url.searchParams.has("to")).toBe(false);
    expect(mailLink("mail_app", { ...draft, to: null })).toMatch(/^mailto:\?subject=/);
  });
});
