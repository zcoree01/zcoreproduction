import { z } from "zod";

// Bell items (D-038): derived from pending work, combined with the caller's
// read / removed state. Pure and unit-tested.

export const notificationKeySchema = z.string().regex(/^[a-z_]{1,30}:[0-9a-f-]{36}$/);
export const notificationKeysSchema = z.array(notificationKeySchema).min(1).max(200);

export type NotificationKind = "close" | "alert" | "approval";

export const notificationKey = (kind: NotificationKind, id: string) => `${kind}:${id}`;

export type NotificationState = { read: string[]; dismissed: string[] };

export type BellSource = {
  key: string;
  group: "approvals" | "attendance" | "close";
  href: string;
  title: string;
  detail: string;
  /** Text of the pop-up. */
  toast: string;
};

export type BellItem = BellSource & { read: boolean };

/** Items not removed by the user, in their order, with their read flag. */
export function bellItems(sources: readonly BellSource[], state: NotificationState): BellItem[] {
  const read = new Set(state.read);
  const dismissed = new Set(state.dismissed);
  return sources
    .filter((source) => !dismissed.has(source.key))
    .map((source) => ({ ...source, read: read.has(source.key) }));
}

export function unreadCount(items: readonly BellItem[]): number {
  return items.filter((item) => !item.read).length;
}

/** Keys of items that should pop up: unread and not shown before. */
export function itemsToAnnounce(
  items: readonly BellItem[],
  shown: ReadonlySet<string>,
): BellItem[] {
  return items.filter((item) => !item.read && !shown.has(item.key));
}
