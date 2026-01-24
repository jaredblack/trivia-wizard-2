import { create } from "zustand";
import { webSocketService } from "../services/websocket";
import type { TeamGameState, ServerMessage } from "../types";
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

/**
 * Subscribe to WebSocket messages relevant to the team.
 * Call in useEffect and return the unsubscribe function.
 */
export function subscribeToTeamMessages() {
  return webSocketService.onMessage((message: ServerMessage) => {
    const state = useTeamStore.getState();
    const {
      step,
      isValidating,
      setIsValidating,
      setStep,
      setError,
      setColor,
      setTeamMembers,
      setTeamGameState,
      setTimerSecondsRemaining,
    } = state;

    switch (message.type) {
      case "joinValidated":
        setIsValidating(false);
        setStep("members");
        break;

      case "timerTick":
        setTimerSecondsRemaining(message.secondsRemaining);
        break;

      case "error": {
        console.error("Server error:", message.message);
        setIsValidating(false);
        const connectionState = webSocketService.connectionState;

        if (step === "game" && connectionState !== "reconnecting") {
          // Team is in game and this isn't from a failed reconnection attempt.
          // Show error but attempt to rejoin automatically.
          setError(message.message);
          webSocketService.reconnect();
        } else {
          // Either not in game yet, or this error is from a reconnection attempt.
          // Show error and go back to join step.
          setError(message.message);
          setStep("join");
        }
        break;
      }

      case "teamGameState": {
        // Check if this is a rejoin response (still on join step, isValidating)
        if (step === "join" && isValidating) {
          // Rejoin scenario - populate store from returned team data
          const teamData = message.state.team;
          setColor({
            hex: teamData.teamColor.hexCode,
            name: teamData.teamColor.name,
          });
          setTeamMembers(teamData.teamMembers);
        }

        setIsValidating(false);
        setTeamGameState(message.state);
        break;
      }
    }
  });
}
