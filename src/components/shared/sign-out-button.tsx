import { LogOutIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/modules/auth/actions";

export async function SignOutButton({ size = "default" }: { size?: "default" | "lg" }) {
  const t = await getTranslations("common");
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline" size={size}>
        <LogOutIcon />
        {t("signOut")}
      </Button>
    </form>
  );
}
