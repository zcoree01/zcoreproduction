// Neutral loading placeholder for Suspense fallbacks and loading.tsx.
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex animate-pulse flex-col gap-4 py-2">
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
      <div className="h-40 w-full rounded-xl bg-muted" />
    </div>
  );
}
