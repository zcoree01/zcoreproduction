// Messages sent to the browser per route group. The root layout's provider
// carries only `root`; (app) and (print) re-provide every message, the
// worker, sign-in and kiosk screens only what their client components read
// (worker screens: ~54 KB instead of ~210 KB on every full load).
// message-scopes.test.ts derives these lists from the import graph and fails
// when a screen starts reading a namespace that is not listed here.

export const MESSAGE_SCOPES = {
  root: ["common"],
  floor: [
    "absences",
    "attendance",
    "common",
    "cutting",
    "dueWarning",
    "duration",
    "errors",
    "externalOperationStatus",
    "floor",
    "floorMachines",
    "floorOrders",
    "floorWarehouse.lot",
    "floorWarehouse.order",
    "floorWarehouse.scanner",
    "floorWork",
    "inventory",
    "kioskPin",
    "machineStatus",
    "nav",
    "operationStatus",
    "orderStatus",
    "orders.attachments",
    "orders.status",
    "passwordForm",
    "priority",
    "problemReports",
    "productUnits",
    "profile.appearance",
    "searchSelect",
    "theme",
  ],
  auth: ["auth.login", "common", "companyFields", "passwordForm", "registration"],
  kiosk: ["kiosk"],
} as const satisfies Record<string, readonly string[]>;

export type MessageScope = keyof typeof MESSAGE_SCOPES;

type Messages = { [key: string]: unknown };

/** Copy of `messages` with only the given paths ("ns" or "ns.sub.sub"). */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const out: Messages = {};
  for (const path of paths) {
    const parts = path.split(".");
    let source: unknown = messages;
    let target = out;
    parts.forEach((part, index) => {
      if (source === undefined) return;
      source = (source as Messages)[part];
      if (source === undefined) return;
      if (index === parts.length - 1) {
        target[part] = source;
      } else {
        target[part] ??= {};
        target = target[part] as Messages;
      }
    });
  }
  return out;
}
