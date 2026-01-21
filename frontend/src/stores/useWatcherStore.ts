import { create } from "zustand";
import type { ScoreboardData } from "../types";

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
