import { create } from "zustand";
import { webSocketService } from "../services/websocket";
import type { ScoreboardData, ServerMessage } from "../types";

interface WatcherStore {
  gameCode: string;
  scoreboardData: ScoreboardData | null;
  error: string | null;
  setGameCode: (code: string) => void;
  setScoreboardData: (data: ScoreboardData) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  gameCode: "",
  scoreboardData: null,
  error: null,
};

export const useWatcherStore = create<WatcherStore>((set) => ({
  ...initialState,

  setGameCode: (gameCode) => set({ gameCode }),

  setScoreboardData: (scoreboardData) => set({ scoreboardData, error: null }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));

/**
 * Subscribe to WebSocket messages relevant to the watcher.
 * Call in useEffect and return the unsubscribe function.
 */
export function subscribeToWatcherMessages() {
  return webSocketService.onMessage((message: ServerMessage) => {
    const { setScoreboardData, setError } = useWatcherStore.getState();

    switch (message.type) {
      case "scoreboardData":
        setScoreboardData(message.data);
        break;
      case "error":
        setError(message.message);
        break;
    }
  });
}
