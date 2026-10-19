export function Loading() {
  return (
    <div className="page center">
      <div className="spinner" />
    </div>
  );
}

export function Failed({ error }: { error: string }) {
  return (
    <div className="page center">
      <p className="muted">Could not load this page.</p>
      <p className="small muted">{error.replace(/^Error: /, "")}</p>
    </div>
  );
}
