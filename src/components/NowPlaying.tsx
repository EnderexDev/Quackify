// The Now Playing panel: the big cover, the song, its main artist, the credits and what's next.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { trackDetails } from "../api/spotify";
import type { TrackDetails } from "../api/types";
import { useNav } from "../state/nav";
import { usePlayer, type NowPlaying } from "../state/player";
import { formatCount } from "../util/format";
import { Cover } from "./Cover";
import { LikeButton } from "./LikeButton";
import { QueueRow } from "./Queue";

export function NowPlayingPanel({ onClose, onOpenQueue }: { onClose: () => void; onOpenQueue: () => void }) {
  const p = usePlayer();
  const nav = useNav();
  const t = p.track;
  const artistUri = t?.artists[0]?.uri ?? "";
  const [details, setDetails] = useState<{ uri: string; value: TrackDetails } | null>(null);
  const next = p.queue[0] ?? null;
  const [nextInfo, setNextInfo] = useState<NowPlaying | null>(null);

  useEffect(() => {
    if (!t || !t.uri.startsWith("spotify:track:") || !artistUri) return;
    let alive = true;
    trackDetails(t.uri, artistUri).then(
      (value) => alive && setDetails({ uri: t.uri, value }),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [t?.uri, artistUri]);

  useEffect(() => {
    if (!next) return;
    let alive = true;
    invoke<NowPlaying[]>("spotify_tracks", { uris: [next.uri] }).then(
      (list) => alive && setNextInfo(list[0] ?? null),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [next?.uri]);

  const d = details && details.uri === t?.uri ? details.value : null;
  const artist = d?.artist;

  return (
    <aside className="queue panel npv">
      <div className="queue-head">
        <h2 className="npv-heading" title={t?.album.name}>
          {t?.album.name || "Now playing"}
        </h2>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="queue-body npv-body">
        {!t && <p className="muted pad">Nothing is playing.</p>}
        {t && (
          <>
            <Cover src={t.image} className="npv-cover" />
            <div className="npv-title-row">
              <div className="npv-text">
                <a className="npv-title" title={t.name} onClick={() => t.album.uri && nav.open(t.album.uri)}>
                  {t.name}
                </a>
                <div className="npv-artists">
                  {t.artists.map((a, i) => (
                    <span key={a.uri || i}>
                      {i > 0 && ", "}
                      <a onClick={() => a.uri && nav.open(a.uri)}>{a.name}</a>
                    </span>
                  ))}
                </div>
              </div>
              <LikeButton uri={t.uri} size={20} />
            </div>

            {artist && (
              <section className="npv-card npv-artist" onClick={() => artist.uri && nav.open(artist.uri)}>
                <div className="npv-artist-image" style={artist.image ? { backgroundImage: `url("${artist.image}")` } : undefined}>
                  <span className="npv-card-label">About the artist</span>
                </div>
                <div className="npv-card-body">
                  <div className="npv-artist-name">
                    {artist.name}
                    {artist.verified && <span className="npv-verified" title="Verified artist">✓</span>}
                  </div>
                  {artist.monthlyListeners !== null && (
                    <div className="muted">{formatCount(artist.monthlyListeners)} monthly listeners</div>
                  )}
                  {artist.bio && <p className="npv-bio">{artist.bio}</p>}
                </div>
              </section>
            )}

            {d && d.credits.length > 0 && (
              <section className="npv-card npv-card-body">
                <h3>Credits</h3>
                {d.credits.map((c) => (
                  <div key={c.name} className="npv-credit">
                    <a className={c.uri ? "" : "plain"} onClick={() => c.uri && nav.open(c.uri)}>
                      {c.name}
                    </a>
                    <div className="muted">{c.roles.join(", ")}</div>
                  </div>
                ))}
              </section>
            )}

            {next && (
              <section className="npv-card npv-card-body">
                <div className="npv-card-head">
                  <h3>Next in queue</h3>
                  <button className="link" onClick={onOpenQueue}>
                    Open queue
                  </button>
                </div>
                <QueueRow track={nextInfo?.uri === next.uri ? nextInfo : undefined} item={next} />
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
