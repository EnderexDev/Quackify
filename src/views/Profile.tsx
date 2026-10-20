// A profile page: yours (with your top artists and songs of the month) or anyone's, with their
// public playlists, the artists they played lately, and Follow.
import { useEffect, useState } from "react";
import { followUser, isFollowingUser, play, profile as loadProfile, topContent } from "../api/spotify";
import type { TopContent } from "../api/types";
import { Shelf } from "../components/Card";
import { TrackList } from "../components/TrackList";
import { toast } from "../state/toast";
import { formatCount } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** `uri`: a spotify:user: URI, or "me". */
export function ProfileView({ uri }: { uri: string }) {
  const username = uri === "me" ? null : uri.split(":")[2] ?? null;
  const { data: p, error, loading } = useAsync(() => loadProfile(username), uri);
  const [top, setTop] = useState<TopContent | null>(null);
  const [following, setFollowing] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!p) return;
    if (p.isMe) topContent().then(setTop, () => setTop(null));
    else isFollowingUser(p.uri).then(setFollowing, () => {});
  }, [p]);

  if (error) return <Failed error={error} />;
  if (loading || !p) return <Loading />;

  const toggleFollow = async () => {
    if (following === undefined) return;
    setBusy(true);
    try {
      await followUser(p.username, !following);
      setFollowing(!following);
    } catch (e) {
      toast(e);
    } finally {
      setBusy(false);
    }
  };

  const stats = [
    p.playlistCount > 0 && `${formatCount(p.playlistCount)} public ${p.playlistCount === 1 ? "playlist" : "playlists"}`,
    `${formatCount(p.followers)} ${p.followers === 1 ? "follower" : "followers"}`,
    `${formatCount(p.following)} following`,
  ].filter(Boolean);

  return (
    <div className="page profile">
      <header className="profile-hero">
        {p.image ? <img className="profile-avatar" src={p.image} alt="" /> : <span className="profile-avatar">{p.name.slice(0, 1).toUpperCase()}</span>}
        <div>
          <span className="hero-kind">Profile</span>
          <h1 className="profile-name">{p.name}</h1>
          <p className="muted">{stats.join(" • ")}</p>
        </div>
      </header>
      {!p.isMe && (
        <div className="actions">
          <button className={`save-btn ${following ? "on" : ""}`} disabled={following === undefined || busy} onClick={toggleFollow}>
            {following ? "Following" : "Follow"}
          </button>
        </div>
      )}
      {top && top.artists.length > 0 && <Shelf title="Top artists this month" cards={top.artists} />}
      {top && top.tracks.length > 0 && (
        <section className="shelf">
          <h2>Top tracks this month</h2>
          <TrackList
            tracks={top.tracks}
            contextUri={null}
            showHeader={false}
            onPlay={(i) => play.tracks(top.tracks.map((t) => t.uri), i).catch(toast)}
          />
        </section>
      )}
      <Shelf title="Public playlists" cards={p.playlists} />
      <Shelf title={p.isMe ? "Recently played artists" : "Artists they played lately"} cards={p.recentArtists} />
      {p.playlists.length === 0 && p.recentArtists.length === 0 && !top && <p className="muted">Nothing public here yet.</p>}
    </div>
  );
}
