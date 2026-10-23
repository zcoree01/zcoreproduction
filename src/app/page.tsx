import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homePathFor } from "@/lib/auth/home";
import { requireMember } from "@/lib/auth/session";

// "/" only routes: proxy.ts sends visitors without a session to /login,
// members go to the home of their role.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <RoleRedirect />
    </Suspense>
  );
}

async function RoleRedirect(): Promise<null> {
  const member = await requireMember();
  redirect(homePathFor(member.role.key));
}
