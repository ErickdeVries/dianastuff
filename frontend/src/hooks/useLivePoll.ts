// Live-shopping realtime state via REST polling of /api/live/feed.
// Replaces Socket.io for live events so state stays consistent across the
// multiple backend workers used in production.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getLiveFeed,
  leaveLive,
  LiveFeedMsg,
  LivePinned,
  LiveProduct,
  LiveViewer,
  sendLivePresence,
} from "@/src/api/live";
import { getViewerId } from "@/src/utils/viewer-id";

export type LiveFloat = { key: string; emoji: string; offset: number };

type Options = {
  enabled: boolean;
  registerPresence: boolean;
  name?: string;
  intervalMs?: number;
};

export function useLivePoll({ enabled, registerPresence, name, intervalMs = 1500 }: Options) {
  const [chat, setChat] = useState<LiveFeedMsg[]>([]);
  const [floats, setFloats] = useState<LiveFloat[]>([]);
  const [viewers, setViewers] = useState<{ count: number; list: LiveViewer[] }>({ count: 0, list: [] });
  const [pinned, setPinned] = useState<LivePinned>(null);
  const [totalLikes, setTotalLikes] = useState(0);
  const [muted, setMuted] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [featured, setFeatured] = useState<LiveProduct | null | undefined>(undefined);

  const seqRef = useRef(0);
  const reactRef = useRef(0);
  const kickedRef = useRef(false);
  const viewerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    // Fresh session: reset cursors + chat so history reloads (and a restarted
    // live show whose seq counter reset from 0 is picked up correctly).
    seqRef.current = 0;
    reactRef.current = 0;
    kickedRef.current = false;
    setChat([]);
    setFloats([]);
    setKicked(false);
    let presenceCounter = 0;

    const tick = async () => {
      try {
        const vid = viewerIdRef.current ?? (viewerIdRef.current = await getViewerId());
        if (registerPresence && !kickedRef.current) {
          // heartbeat every ~3rd poll to reduce writes
          if (presenceCounter % 3 === 0) sendLivePresence({ viewerId: vid, name }).catch(() => {});
          presenceCounter += 1;
        }
        const feed = await getLiveFeed({ sinceSeq: seqRef.current, sinceReact: reactRef.current, viewerId: vid });
        if (!alive) return;
        if (feed.messages?.length) {
          seqRef.current = feed.last_seq;
          setChat((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const add = feed.messages.filter((m) => !seen.has(m.id));
            return add.length ? [...prev, ...add].slice(-100) : prev;
          });
        }
        if (feed.reactions?.length) {
          reactRef.current = feed.last_react;
          setFloats((prev) =>
            [
              ...prev,
              ...feed.reactions.map((r) => ({
                key: `${r.seq}-${Math.random()}`,
                emoji: r.emoji || "❤️",
                offset: Math.random() * 40,
              })),
            ].slice(-24),
          );
        }
        setViewers({ count: feed.viewers_count ?? 0, list: feed.viewers ?? [] });
        setPinned(feed.pinned ?? null);
        setTotalLikes(feed.total_likes ?? 0);
        setMuted(!!feed.muted);
        if (feed.kicked) {
          kickedRef.current = true;
          setKicked(true);
        }
        setFeatured(feed.featured ?? null);
      } catch {
        // transient network error — keep polling
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    tick();

    return () => {
      alive = false;
      clearTimeout(timer);
      if (registerPresence && viewerIdRef.current) leaveLive({ viewerId: viewerIdRef.current }).catch(() => {});
    };
  }, [enabled, registerPresence, name, intervalMs]);

  const removeFloat = useCallback((key: string) => {
    setFloats((prev) => prev.filter((f) => f.key !== key));
  }, []);

  // Optimistically show my own reaction immediately (polling will catch others').
  const addFloat = useCallback((emoji: string) => {
    setFloats((prev) =>
      [...prev, { key: `self-${Date.now()}-${Math.random()}`, emoji, offset: Math.random() * 40 }].slice(-24),
    );
  }, []);

  const getVid = useCallback(async () => {
    return viewerIdRef.current ?? (viewerIdRef.current = await getViewerId());
  }, []);

  return {
    chat,
    floats,
    removeFloat,
    addFloat,
    viewers,
    pinned,
    totalLikes,
    muted,
    kicked,
    featured,
    getVid,
  };
}
