import { useCallback, useEffect, useRef, useState } from "react";
import { buildPresets } from "../../deck/game";
import { loadDeckBundle, type DeckBundle } from "../../presentation/loadDeck";
import { useHostStore } from "../../stores/useHostStore";
import type { ClientMessage } from "../../types";

export type DeckStatus = "none" | "loading" | "ready" | "error";

export interface GameDeck {
  /** The event this game runs from, attached or about to be. */
  uuid: string | null;
  status: DeckStatus;
  error: string | null;
  bundle: DeckBundle | null;
  /** Re-read the deck and hand the server the new presets. */
  reload: () => void;
}

/**
 * The deck behind a live game, as the scoring view sees it.
 *
 * The server holds the presets (so questions are created correctly whoever is
 * connected); this hook loads the deck's content for display, and is what
 * sends the presets when a deck is first attached or reloaded.
 */
export function useGameDeck(send: (message: ClientMessage) => void): GameDeck {
  const gameCode = useHostStore((s) => s.gameCode);
  const attachedUuid = useHostStore((s) => s.deck?.uuid ?? null);
  const pendingUuid = useHostStore((s) => s.pendingDeckUuid);
  const setPendingDeckUuid = useHostStore((s) => s.setPendingDeckUuid);

  const uuid = attachedUuid ?? pendingUuid;
  const [bundle, setBundle] = useState<DeckBundle | null>(null);
  const [status, setStatus] = useState<DeckStatus>("none");
  const [error, setError] = useState<string | null>(null);
  // Which uuid has been (or is being) loaded, so re-renders don't refetch.
  const loadedFor = useRef<string | null>(null);

  const load = useCallback(
    async (id: string, attach: "initial" | "reload" | "none") => {
      setStatus("loading");
      setError(null);
      try {
        const next = await loadDeckBundle(id);
        if (loadedFor.current !== id) return; // a different deck took over
        setBundle(next);
        setStatus("ready");
        if (attach !== "none") {
          send({
            host: {
              type: "setDeck",
              uuid: id,
              presets: buildPresets(next.deck),
              applyToCurrent: attach === "initial",
            },
          });
        }
      } catch (e) {
        if (loadedFor.current !== id) return;
        console.error("Failed to load deck:", e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [send]
  );

  useEffect(() => {
    if (!gameCode || !uuid) {
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === uuid) return;
    loadedFor.current = uuid;
    // Already attached (a rejoin): the server has the presets, so only the
    // content is needed. Otherwise this is the first attach for a new game.
    void load(uuid, attachedUuid ? "none" : "initial");
  }, [gameCode, uuid, attachedUuid, load]);

  // The server has confirmed the attach; nothing is pending any more.
  useEffect(() => {
    if (attachedUuid && pendingUuid) setPendingDeckUuid(null);
  }, [attachedUuid, pendingUuid, setPendingDeckUuid]);

  const reload = useCallback(() => {
    // If the first attach never went through (the deck failed to load), this
    // is still that first attach.
    if (uuid) void load(uuid, attachedUuid ? "reload" : "initial");
  }, [uuid, attachedUuid, load]);

  return {
    uuid,
    status: uuid ? status : "none",
    error,
    bundle: uuid ? bundle : null,
    reload,
  };
}
