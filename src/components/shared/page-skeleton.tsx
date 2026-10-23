import { Skeleton } from "@/components/ui/skeleton";

// Neutral loading placeholder for Suspense fallbacks.
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
