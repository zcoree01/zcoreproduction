import type { TextSize } from "@/modules/profile/schemas";

// The user's text size preference: globals.css enlarges the root font size
// while this marker is on the page (rem-based sizes all follow).
export function TextSizeMarker({ size }: { size: TextSize }) {
  return size === "large" ? <span hidden data-text-size="large" /> : null;
}
