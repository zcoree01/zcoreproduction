"use client";

import { ArchiveIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { setCustomerArchivedAction } from "@/modules/customers/actions";
import type { CustomerRow } from "@/modules/customers/queries";
import { CustomerSheet } from "../customer-sheet";

export function CustomerActions({ customer }: { customer: CustomerRow }) {
  const t = useTranslations("customers");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const setArchived = async (archived: boolean) => {
    const result = await setCustomerArchivedAction(customer.id, archived);
    if (result.ok) {
      toast.success(t(archived ? "archivedToast" : "restoredToast", { name: customer.name }));
      router.refresh();
    } else {
      toast.error(t(`form.errors.${result.error}`));
    }
  };

  if (customer.archived) {
    return (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => setArchived(false))}
      >
        <RotateCcwIcon />
        {t("restore")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setEditing(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="outline">
            <ArchiveIcon />
            {t("archive")}
          </Button>
        }
        title={t("archiveTitle", { name: customer.name })}
        description={t("archiveDescription")}
        confirmLabel={t("archive")}
        destructive
        onConfirm={() => setArchived(true)}
      />
      <CustomerSheet open={editing} onOpenChange={setEditing} customer={customer} />
    </div>
  );
}
