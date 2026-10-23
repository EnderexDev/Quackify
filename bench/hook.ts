// Counts which components rendered in each React commit, the way React DevTools tells: a fiber
// that did work has the PerformedWork flag, and a subtree React skipped keeps its old children.
// Loaded before React so react-dom finds the hook.
const PERFORMED_WORK = 1;
type Fiber = {
  tag: number;
  type: unknown;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
};

const counts = new Map<string, number>();
let commits = 0;

function nameOf(f: Fiber): string | null {
  // 0 function, 1 class, 11 forwardRef, 14 memo, 15 simple memo.
  if (![0, 1, 11, 14, 15].includes(f.tag)) return null;
  const t = f.type as { displayName?: string; name?: string; type?: { name?: string }; render?: { name?: string } } | null;
  return t?.displayName ?? t?.name ?? t?.type?.name ?? t?.render?.name ?? "anon";
}

function walk(f: Fiber | null) {
  for (; f; f = f.sibling) {
    const fresh = !f.alternate;
    if (fresh || f.flags & PERFORMED_WORK) {
      const n = nameOf(f);
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    // A bailed-out subtree still points at the children of the previous commit.
    if (!fresh && f.child === f.alternate!.child) continue;
    walk(f.child);
  }
}

if (!location.search.includes("nohook")) (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  renderers: new Map(),
  inject: () => 1,
  onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
    commits++;
    walk(root.current.child);
  },
  onCommitFiberUnmount: () => {},
  onPostCommitFiberRoot: () => {},
  onScheduleFiberRoot: () => {},
  checkDCE: () => {},
};

(window as unknown as Record<string, unknown>).__renders = {
  reset() {
    counts.clear();
    commits = 0;
  },
  read() {
    return { commits, byComponent: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])) };
  },
};
