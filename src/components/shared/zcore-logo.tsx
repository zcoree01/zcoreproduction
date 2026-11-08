import { cn } from "@/lib/utils";

// Zcore mark from www.zcore.ba (same paths as src/app/icon.svg): two corner
// pieces and the diagonal. Uses currentColor; the classes m1/m2/m3 let the
// loader assemble it.
export function ZcoreMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="124 100 521 568"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-auto w-10 overflow-visible fill-current", className)}
      aria-hidden
    >
      <path
        className="m1"
        d="M132,100 L402,100 C290,106 186,186 137,322 Q135,329 130,327 Q128,326 128,320 L128,104 Q128,100 132,100 Z"
      />
      <path
        className="m2"
        d="M636,668 L366,668 C478,662 582,582 631,446 Q633,439 638,441 Q640,442 640,448 L640,664 Q640,668 636,668 Z"
      />
      <path
        className="m3"
        d="M601,100 L638,100 Q645,100 640,106 L170,668 L131,668 Q124,668 129,662 Z"
      />
    </svg>
  );
}
