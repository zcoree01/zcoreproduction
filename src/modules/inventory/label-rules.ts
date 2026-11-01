import { z } from "zod";

// QR labels of the warehouse (D-033). A label carries a link into the app, so
// a phone camera opens the right screen as well; the in-app scanner reads the
// same links (and the order QR of the work order print, /floor/orders/<id>).

export type ScanTarget =
  | { kind: "lot"; lotId: string }
  | { kind: "location"; locationId: string }
  | { kind: "order"; orderId: string };

/** App path a label points to. */
export function lotLabelPath(lotId: string): string {
  return `/floor/warehouse/lot/${lotId}`;
}

export function locationLabelPath(locationId: string): string {
  return `/floor/warehouse/location/${locationId}`;
}

const uuid = z.uuid();
const PATTERNS: readonly [RegExp, (id: string) => ScanTarget][] = [
  [/\/floor\/warehouse\/lot\/([0-9a-f-]{36})(?:[/?#]|$)/i, (id) => ({ kind: "lot", lotId: id })],
  [
    /\/floor\/warehouse\/location\/([0-9a-f-]{36})(?:[/?#]|$)/i,
    (id) => ({ kind: "location", locationId: id }),
  ],
  [/\/floor\/orders\/([0-9a-f-]{36})(?:[/?#]|$)/i, (id) => ({ kind: "order", orderId: id })],
];

/** What a scanned (or typed) code points to, or null for anything else. */
export function parseScan(code: string): ScanTarget | null {
  const text = code.trim();
  for (const [pattern, target] of PATTERNS) {
    const id = pattern.exec(text)?.[1]?.toLowerCase();
    if (id && uuid.safeParse(id).success) return target(id);
  }
  return null;
}

/** Path the in-app scanner opens for a target. */
export function scanTargetPath(target: ScanTarget): string {
  switch (target.kind) {
    case "lot":
      return lotLabelPath(target.lotId);
    case "location":
      return locationLabelPath(target.locationId);
    case "order":
      return `/floor/warehouse/order/${target.orderId}`;
  }
}

export const LABEL_SIZES = ["50x30", "70x40", "a4"] as const;
export type LabelSize = (typeof LABEL_SIZES)[number];

export function parseLabelSize(value: unknown): LabelSize {
  return z.enum(LABEL_SIZES).catch("70x40").parse(value);
}
