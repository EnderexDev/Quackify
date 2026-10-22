// The New playlist dialog (Figma "nova playlist"): name, an optional description and, when it
// comes from songs, "Also add …". Its name starts as today's "My Playlist #N", so Enter gives
// what Ctrl N gave before.
import { useEffect, useRef, useState } from "react";
import { createPlaylist, editPlaylist } from "../api/library";
import { clearCache, library } from "../api/spotify";
import { useNav } from "../state/nav";
import { NEW_PLAYLIST_EVENT, type NewPlaylistFrom } from "../state/newPlaylist";
import { notifyLibraryChanged } from "../state/saved";
import { toast } from "../state/toast";
import { Dialog } from "./Dialog";
import { CheckIcon } from "./icons";
import { LIBRARY_PAGE } from "./libraryItems";
import { addAll } from "./menus";

/** The next free "My Playlist #N" among your playlists, every page of them read. */
async function nextName(): Promise<string> {
  const taken = new Set<number>();
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

/** One playlist made at a time, so two quick ones get different numbers. */
let creating: Promise<unknown> = Promise.resolve();

/** Listens for newPlaylist() and shows the dialog. */
export function NewPlaylistHost() {
  const [open, setOpen] = useState<{ from?: NewPlaylistFrom; at: number } | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => setOpen({ from: (e as CustomEvent<NewPlaylistFrom | undefined>).detail, at: Date.now() });
    window.addEventListener(NEW_PLAYLIST_EVENT, onAsk);
    return () => window.removeEventListener(NEW_PLAYLIST_EVENT, onAsk);
  }, []);
  if (!open) return null;
  return <NewPlaylistDialog key={open.at} from={open.from} onClose={() => setOpen(null)} />;
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
  const create = () => {
    if (!finalName || busy) return;
    setBusy(true);
    const run = async () => {
      try {
        const uri = await createPlaylist(finalName);
        if (description.trim()) await editPlaylist(uri, finalName, description.trim());
        let added = 0;
        if (from && addSongs) {
          const uris = await from.songs();
          if (uris.length) await addAll(uri, uris);
          added = uris.length;
        }
        // The next one must see this one: Your Library's cached pages are stale now.
        clearCache("library:");
        notifyLibraryChanged();
        if (added) toast(`Added ${added === 1 ? "1 song" : `${added} songs`} to ${finalName}`);
        onClose();
        nav.open(uri);
      } catch (e) {
        toast(e);
        setBusy(false);
      }
    };
    creating = creating.then(run, run);
  };

  return (
    <Dialog title="New playlist" onClose={onClose} busy={busy}>
      <div className="new-playlist">
        <div className="new-playlist-fields">
          <input
            ref={input}
            className="new-playlist-name"
            value={name}
            maxLength={100}
            disabled={busy}
            placeholder={suggested || "Name"}
            aria-label="Name"
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
            placeholder="Description (optional)"
            aria-label="Description"
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
            Also add “{from.label}”
          </button>
        )}
        <button className="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary new-playlist-create" onClick={create} disabled={busy || !finalName}>
          Create
        </button>
      </div>
    </Dialog>
  );
}
