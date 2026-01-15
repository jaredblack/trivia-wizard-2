import { create } from "zustand";
import type { TeamGameState } from "../types";
import type { TeamColorOption } from "../utils/colors";

export type TeamStep = "join" | "members" | "color" | "game";

interface TeamStore {
  // Join flow state
  step: TeamStep;
  gameCode: string;
  teamName: string;
  teamMembers: string[];
  selectedColor: TeamColorOption | null;
  isValidating: boolean;

  // Game state (from server after joining)
  teamGameState: TeamGameState | null;

  // Error state
  error: string | null;

  // Actions
  setStep: (step: TeamStep) => void;
  setGameCode: (code: string) => void;
  setTeamName: (name: string) => void;
  setTeamMembers: (members: string[]) => void;
  addMember: () => void;
  removeMember: (index: number) => void;
  setMemberName: (index: number, name: string) => void;
  setColor: (color: TeamColorOption) => void;
  setIsValidating: (isValidating: boolean) => void;
  setTeamGameState: (state: TeamGameState) => void;
  setTimerSecondsRemaining: (seconds: number) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  step: "join" as TeamStep,
  gameCode: "",
  teamName: "",
  teamMembers: [""],
  selectedColor: null,
  isValidating: false,
  teamGameState: null,
  error: null,
};

export const useTeamStore = create<TeamStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setGameCode: (gameCode) => set({ gameCode }),

  setTeamName: (teamName) => set({ teamName }),

  setTeamMembers: (teamMembers) => set({ teamMembers }),

  addMember: () =>
    set((state) => ({
      teamMembers: [...state.teamMembers, ""],
    })),

  removeMember: (index) =>
    set((state) => ({
      teamMembers: state.teamMembers.filter((_, i) => i !== index),
    })),

  setMemberName: (index, name) =>
    set((state) => ({
      teamMembers: state.teamMembers.map((m, i) => (i === index ? name : m)),
    })),

  setColor: (selectedColor) => set({ selectedColor }),

  setIsValidating: (isValidating) => set({ isValidating }),

  setTeamGameState: (teamGameState) => set({ teamGameState, step: "game" }),

  setTimerSecondsRemaining: (seconds) =>
    set((state) => ({
      teamGameState: state.teamGameState
        ? { ...state.teamGameState, timerSecondsRemaining: seconds }
        : null,
    })),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
