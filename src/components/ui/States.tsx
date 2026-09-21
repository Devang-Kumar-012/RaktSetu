import { Card } from "@/components/ui/Card";

/** Shown when a list or section has nothing to display yet. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 border-dashed px-8 py-14 text-center">
      <h3 className="text-xl font-bold text-ink-900">{title}</h3>
      {description && <p className="max-w-md text-base text-ink-600">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}

/** Used for routes/features that are not built yet. Honest, no dead buttons. */
export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="px-8 py-12 text-center" raised>
      <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
        In progress
      </p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900">
        {title}
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-600">{description}</p>
    </Card>
  );
}

/** Generic error panel. */
export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
}: {
  title?: string;
  description?: string;
  retry?: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-4 px-8 py-12 text-center">
      <h3 className="text-xl font-bold text-ink-900">{title}</h3>
      {description && <p className="max-w-md text-base text-ink-600">{description}</p>}
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-blood-700 px-6 py-3 font-semibold text-white hover:bg-blood-800"
        >
          Try again
        </button>
      )}
    </Card>
  );
}
