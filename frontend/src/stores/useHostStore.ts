import { create } from "zustand";
import type {
  GameCreated,
  GameSettings,
  Question,
  TeamData,
} from "../types";

interface HostStore {
  // State from GameCreated
  gameCode: string | null;
  currentQuestionNumber: number;
  gameSettings: GameSettings | null;
  currentQuestion: Question | null;
  teams: TeamData[];

  // Actions
  setGameData: (data: GameCreated) => void;
  clearGame: () => void;
}

export const useHostStore = create<HostStore>((set) => ({
  // Initial state
  gameCode: null,
  currentQuestionNumber: 0,
  gameSettings: null,
  currentQuestion: null,
  teams: [],

  // Actions
  setGameData: (data: GameCreated) =>
    set({
      gameCode: data.gameCode,
      currentQuestionNumber: data.currentQuestionNumber,
      gameSettings: data.gameSettings,
      currentQuestion: data.currentQuestion,
      teams: data.teams,
    }),

  clearGame: () =>
    set({
      gameCode: null,
      currentQuestionNumber: 0,
      gameSettings: null,
      currentQuestion: null,
      teams: [],
    }),
}));
