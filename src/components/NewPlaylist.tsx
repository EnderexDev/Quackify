// The New playlist dialog (Figma "nova playlist"): name, an optional description and, when it
// comes from songs, "Also add …". Its name starts as today's "My Playlist #N", so Enter gives
// what Ctrl N gave before.
import { useEffect, useRef, useState } from "react";
import { createPlaylist, editPlaylist } from "../api/library";
import { clearCache, library } from "../api/spotify";
import { useNav } from "../state/nav";
import { NEW_PLAYLIST_EVENT, type NewPlaylistFrom } from "../state/newPlaylist";
import { notifyLibraryChanged } from "../state/saved";
import { notify, toast } from "../state/toast";
import { t } from "../i18n";
import { Dialog } from "./Dialog";
import { CheckIcon } from "./icons";
import { LIBRARY_PAGE } from "./libraryItems";
import { addAll } from "./menus";

/** The names of the playlists made since the app started. */
const madeHere = new Set<string>();

/** The next free "My Playlist #N" among your playlists, every page of them read. */
async function nextName(): Promise<string> {
  // Spotify's library search sees a new playlist only after a while: the ones made here
  // count as taken at once.
  const taken = new Set<number>([...madeHere].map((n) => Number(/^My Playlist #(\d+)$/.exec(n)?.[1])).filter(Boolean));
  for (let offset = 0; ; offset += LIBRARY_PAGE) {
    const page = await library({ filter: "Playlists", text: "My Playlist #" }, offset);
    for (const c of page.items) {
      const n = /^My Playlist #(\d+)$/.exec(c.title)?.[1];
      if (n) taken.add(Number(n));
    }
    if (!page.items.length || offset + LIBRARY_PAGE >= page.total) break;
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `My Playlist #${n}`;
}

/** Tells each dialog apart, even two asked in the same millisecond. */
let asked = 0;

/** One playlist made at a time, so two quick ones get different numbers. */
let creating: Promise<unknown> = Promise.resolve();

/** Listens for newPlaylist() and shows the dialog. */
export function NewPlaylistHost() {
  const [open, setOpen] = useState<{ from?: NewPlaylistFrom; at: number } | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => setOpen({ from: (e as CustomEvent<NewPlaylistFrom | undefined>).detail, at: ++asked });
    window.addEventListener(NEW_PLAYLIST_EVENT, onAsk);
    return () => window.removeEventListener(NEW_PLAYLIST_EVENT, onAsk);
  }, []);
  if (!open) return null;
  // A creation that ends after another dialog opened closes only its own.
  const at = open.at;
  return <NewPlaylistDialog key={at} from={open.from} onClose={() => setOpen((o) => (o?.at === at ? null : o))} />;
}

function NewPlaylistDialog({ from, onClose }: { from?: NewPlaylistFrom; onClose: () => void }) {
  const nav = useNav();
  const [name, setName] = useState(from?.name ?? "");
  const [suggested, setSuggested] = useState(from?.name ?? "");
  const [description, setDescription] = useState("");
  const [addSongs, setAddSongs] = useState(true);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Until it is typed in, the name follows the suggestion as it arrives.
  const touched = useRef(false);

  useEffect(() => {
    if (from?.name) return input.current?.select();
    let alive = true;
    nextName().then(
      (n) => {
        if (!alive) return;
        setSuggested(n);
        if (!touched.current) {
          setName(n);
          requestAnimationFrame(() => input.current?.select());
        }
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [from]);

  const finalName = name.trim() || suggested;
  // What is done already, so a retry after a failure only does the rest (and never makes a
  // second playlist).
  const made = useRef<{ uri: string; name: string; description: string; described: boolean; filled: boolean } | null>(null);
  const create = () => {
    if (!finalName || busy) return;
    setBusy(true);
    const run = async () => {
      try {
        let step = made.current;
        if (!step) {
          // An untouched suggestion is read again here, after the creations queued before
          // it, so two quick ones get different numbers.
          const n = !touched.current && !from?.name ? await nextName() : finalName;
          const uri = await createPlaylist(n);
          step = made.current = { uri, name: n, description: "", described: false, filled: false };
          madeHere.add(n);
          // The next one must see this one: Your Library's cached pages are stale now.
          clearCache("library:");
          notifyLibraryChanged();
        }
        // The name and description as they are now: edited after a failure, the retry saves them.
        // An untouched field still shows the first suggestion: the name made is the one.
        const wantName = (touched.current && name.trim()) || step.name;
        const wantDescription = description.trim();
        if (wantName !== step.name || (wantDescription && !step.described) || (step.described && wantDescription !== step.description)) {
          await editPlaylist(step.uri, wantName, wantDescription);
          step.name = wantName;
          step.description = wantDescription;
          madeHere.add(wantName);
        }
        step.described = true;
        let added = 0;
        if (!step.filled && from && addSongs) {
          const uris = await from.songs();
          if (uris.length) await addAll(step.uri, uris);
          added = uris.length;
        }
        step.filled = true;
        if (added) notify(added === 1 ? t("Added 1 song to {name}", { name: step.name }) : t("Added {n} songs to {name}", { n: added, name: step.name }));
        onClose();
        nav.open(step.uri);
      } catch (e) {
        toast(e);
        setBusy(false);
      }
    };
    creating = creating.then(run, run);
  };

  return (
    <Dialog title={t("New playlist")} onClose={onClose} busy={busy}>
      <div className="new-playlist">
        <div className="new-playlist-fields">
          <input
            ref={input}
            className="new-playlist-name"
            value={name}
            maxLength={100}
            disabled={busy}
            placeholder={suggested || t("Name")}
            aria-label={t("Name")}
            onChange={(e) => {
              touched.current = true;
              setName(e.currentTarget.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <textarea
            className="new-playlist-description"
            value={description}
            maxLength={300}
            rows={2}
            disabled={busy}
            placeholder={t("Description (optional)")}
            aria-label={t("Description")}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </div>
      </div>
      <div className="dialog-actions new-playlist-actions">
        {from && (
          <button
            className={`new-playlist-check ${addSongs ? "on" : ""}`}
            role="checkbox"
            aria-checked={addSongs}
            disabled={busy}
            onClick={() => setAddSongs(!addSongs)}
          >
            <span className="box">{addSongs && <CheckIcon size={12} />}</span>
            {t("Also add “{label}”", { label: from.label })}
          </button>
        )}
        <button className="secondary" onClick={onClose} disabled={busy}>
          {t("Cancel")}
        </button>
        <button className="primary new-playlist-create" onClick={create} disabled={busy || !finalName}>
          {t("Create")}
        </button>
      </div>
    </Dialog>
  );
}
