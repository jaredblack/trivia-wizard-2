import { create } from "zustand";
import { webSocketService } from "../services/websocket";
import type { ScoreboardData, ServerMessage, TeamData } from "../types";

interface WatcherStore {
  gameCode: string;
  teams: TeamData[] | null;
  timerRunning: boolean;
  timerSecondsRemaining: number | null;
  error: string | null;
  setGameCode: (code: string) => void;
  setScoreboardData: (data: ScoreboardData) => void;
  setTimerSecondsRemaining: (seconds: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  gameCode: "",
  teams: null as TeamData[] | null,
  timerRunning: false,
  timerSecondsRemaining: null as number | null,
  error: null,
};

export const useWatcherStore = create<WatcherStore>((set) => ({
  ...initialState,

  setGameCode: (gameCode) => set({ gameCode }),

  setScoreboardData: (data) =>
    set({
      teams: data.teams,
      timerRunning: data.timerRunning,
      timerSecondsRemaining: data.timerSecondsRemaining,
      error: null,
    }),

  setTimerSecondsRemaining: (seconds) =>
    set({ timerSecondsRemaining: seconds }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));

/**
 * Subscribe to WebSocket messages relevant to the watcher.
 * Call in useEffect and return the unsubscribe function.
 */
export function subscribeToWatcherMessages() {
  return webSocketService.onMessage((message: ServerMessage) => {
    const { setScoreboardData, setTimerSecondsRemaining, setError } =
      useWatcherStore.getState();

    switch (message.type) {
      case "scoreboardData":
        setScoreboardData(message.data);
        break;
      case "timerTick":
        setTimerSecondsRemaining(message.secondsRemaining);
        break;
      case "error":
        setError(message.message);
        break;
    }
  });
}
