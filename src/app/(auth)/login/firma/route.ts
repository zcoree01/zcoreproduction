import { orgSlugSchema } from "@/lib/auth/username";
import { companyLoginUrl, requestHost } from "@/lib/tenant/resolve";
import { getLoginOrganizationName } from "@/modules/auth/queries";

// "Adresa firme" on a sign-in page without a company (app.zcore.ba, D-047):
// a known address goes to that company's sign-in page, otherwise back with
// a notice. Only says whether the address exists (like the login screen).

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = (url.searchParams.get("adresa") ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.zcore\.ba$/, "");
  const back = new URL("/login", url);
  const slug = orgSlugSchema.safeParse(input);
  if (!slug.success || !(await getLoginOrganizationName(slug.data))) {
    back.searchParams.set("firma", "nepoznata");
    if (input) back.searchParams.set("adresa", input.slice(0, 63));
    return Response.redirect(back, 303);
  }
  const host = requestHost(request.headers) ?? url.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return Response.redirect(companyLoginUrl({ host, protocol, slug: slug.data }), 303);
}
