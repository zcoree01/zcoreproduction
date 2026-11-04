import { ImageResponse } from "next/og";

// App icon of the installable kiosk (D-048): a full-bleed square, so Android
// can mask it (the letter stays inside the safe zone).
export function kioskIcon(size: number): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#171717",
        color: "#fafafa",
        fontSize: size * 0.5,
        fontWeight: 700,
      }}
    >
      Z
    </div>,
    { width: size, height: size },
  );
}
