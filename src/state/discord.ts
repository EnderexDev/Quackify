// What plays, for the Discord profile (discord.rs): the song, its cover, the time left, and for
// friends a button to open it on Spotify and, during a Jam, one to join it. Nothing while paused.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";
import type { Jam } from "./jam";
import type { Player } from "./player";

/** A start that moved less than this (the clock's own drift) is not sent again. */
const DRIFT_MS = 3000;

type Presence = {
  details: string;
  state: string;
  image: string | null;
  image_text: string | null;
  start_ms: number;
  end_ms: number | null;
  buttons: { label: string; url: string }[];
};

export function useDiscordPresence(p: Player, jam: Jam | null) {
  const song = p.track;
  const playing = p.playing && !!song;
  // When the song started, as Discord counts it; kept while the clock only drifts.
  const start = useRef(0);
  const startUri = useRef<string | null>(null);
  // Whole milliseconds: the Rust side takes integers, and the position is extrapolated.
  const now = playing ? Math.round(Date.now() - p.position()) : 0;
  // A new song always takes its own start; within one song only a real jump (a seek) does.
  if (song?.uri !== startUri.current || Math.abs(now - start.current) > DRIFT_MS) {
    start.current = now;
    startUri.current = song?.uri ?? null;
  }
  const startMs = start.current;

  useEffect(() => {
    if (!song || !playing) {
      invoke("discord_presence", { presence: null }).catch(() => {});
      return;
    }
    const [, kind, id] = song.uri.split(":");
    const buttons: Presence["buttons"] = [];
    if (jam) buttons.push({ label: t("Join the Jam"), url: jam.share_url });
    if (id && (kind === "track" || kind === "episode")) buttons.push({ label: t("Listen on Spotify"), url: `https://open.spotify.com/${kind}/${id}` });
    const presence: Presence = {
      details: song.name,
      state: song.artists.map((a) => a.name).join(", ") || song.album.name,
      image: song.image,
      image_text: song.album.name || null,
      start_ms: startMs,
      end_ms: song.duration_ms ? startMs + song.duration_ms : null,
      buttons,
    };
    invoke("discord_presence", { presence }).catch(() => {});
  }, [song, playing, startMs, jam?.share_url]);
}
