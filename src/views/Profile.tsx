// A profile page: yours (with your top artists and songs of the month) or anyone's, with their
// public playlists, the artists they played lately, and Follow.
import { useEffect, useState } from "react";
import { followUser, isFollowingUser, play, profile as loadProfile, topContent } from "../api/spotify";
import type { TopContent } from "../api/types";
import { Shelf } from "../components/Card";
import { useContextMenu } from "../components/ContextMenu";
import { copy, webLink } from "../components/menus";
import { TrackList } from "../components/TrackList";
import { toast } from "../state/toast";
import { formatCount } from "../util/format";
import { useAsync } from "../util/useAsync";
import { Failed, Loading } from "./common";

/** `uri`: a spotify:user: URI, or "me". */
export function ProfileView({ uri }: { uri: string }) {
  const username = uri === "me" ? null : uri.split(":")[2] ?? null;
  const { data: p, error, loading, retry } = useAsync(() => loadProfile(username), uri);
  const [top, setTop] = useState<TopContent | null>(null);
  const [following, setFollowing] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [allTracks, setAllTracks] = useState(false);
  const openMenu = useContextMenu();

  useEffect(() => {
    if (!p) return;
    if (p.isMe) topContent().then(setTop, () => setTop(null));
    else isFollowingUser(p.uri).then(setFollowing, () => {});
  }, [p]);

  if (error) return <Failed error={error} onRetry={retry} />;
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

  const copyLink = () => copy(webLink(p.uri));
  const shownTracks = top ? (allTracks ? top.tracks : top.tracks.slice(0, 5)) : [];

  return (
    <div className="page profile">
      <header className="profile-hero">
        {p.image ? <img className="profile-avatar" src={p.image} alt="" /> : <span className="profile-avatar">{p.name.slice(0, 1).toUpperCase()}</span>}
        <div className="profile-text">
          <span className="hero-kind">Profile</span>
          <h1 className="profile-name">{p.name}</h1>
          <p className="muted">{stats.join(" • ")}</p>
          <div className="profile-actions">
            {p.isMe ? (
              <button className="pill-button" onClick={copyLink}>
                Copy profile link
              </button>
            ) : (
              <button className={`save-btn ${following ? "on" : ""}`} disabled={following === undefined || busy} onClick={toggleFollow}>
                {following ? "Following" : "Follow"}
              </button>
            )}
            <button
              className="more-btn"
              aria-label={`More options for ${p.name}`}
              title="More options"
              onClick={(e) => openMenu(e, [{ label: "Copy profile link", onClick: copyLink }])}
            >
              •••
            </button>
          </div>
        </div>
      </header>
      {top && top.artists.length > 0 && <Shelf title="Top artists this month" note="only you see this" cards={top.artists} />}
      {top && top.tracks.length > 0 && (
        <section className="shelf">
          <div className="shelf-head">
            <h2>
              Top tracks this month<span className="shelf-note">only you see this</span>
            </h2>
          </div>
          <TrackList
            tracks={shownTracks}
            contextUri={null}
            showHeader={false}
            onPlay={(i) => play.tracks(top.tracks.map((t) => t.uri), i).catch(toast)}
          />
          {top.tracks.length > 5 && (
            <button className="link see-more" onClick={() => setAllTracks(!allTracks)}>
              {allTracks ? "Show less" : "See more"}
            </button>
          )}
        </section>
      )}
      <Shelf title="Public playlists" cards={p.playlists} />
      <Shelf title={p.isMe ? "Recently played artists" : "Artists they played lately"} cards={p.recentArtists} />
      {p.playlists.length === 0 && p.recentArtists.length === 0 && !top && <p className="muted">Nothing public here yet.</p>}
    </div>
  );
}
