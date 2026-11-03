"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { updateMemberAction } from "@/modules/users/actions";
import type { UserTableRow } from "./users-table";

/** Full name and role of another member (D-044); the username stays. */
export function EditMemberSheet({
  member,
  roles,
  onClose,
}: {
  member: UserTableRow | null;
  roles: { id: string; label: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("users.edit");
  return (
    <Sheet open={member !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="flex flex-col gap-0 p-0 sm:max-w-md">
        {member ? (
          <EditMemberForm key={member.userId} member={member} roles={roles} onDone={onClose} />
        ) : (
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditMemberForm({
  member,
  roles,
  onDone,
}: {
  member: UserTableRow;
  roles: { id: string; label: string }[];
  onDone: () => void;
}) {
  const t = useTranslations("users");
  const [fullName, setFullName] = useState(member.fullName ?? "");
  const [roleId, setRoleId] = useState(member.roleId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await updateMemberAction(member.userId, { fullName, roleId });
      if (!result.ok) {
        setError(t(`memberErrors.${result.error}`));
        return;
      }
      toast.success(t("edit.saved", { username: member.username }));
      onDone();
    });

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{t("edit.title")}</SheetTitle>
        <SheetDescription>{t("edit.description", { username: member.username })}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="member-full-name">{t("columns.fullName")}</FieldLabel>
            <Input
              id="member-full-name"
              value={fullName}
              maxLength={200}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="member-role">{t("columns.role")}</FieldLabel>
            <NativeSelect
              id="member-role"
              className="w-full"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              {roles.map((role) => (
                <NativeSelectOption key={role.id} value={role.id}>
                  {role.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>{t("edit.roleHint")}</FieldDescription>
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter className="border-t">
        <Button onClick={save} disabled={pending || fullName.trim() === ""}>
          {t("edit.save")}
        </Button>
      </SheetFooter>
    </>
  );
}
