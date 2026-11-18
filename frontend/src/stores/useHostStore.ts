import { create } from "zustand";
import { webSocketService } from "../services/websocket";
import type {
  DeckState,
  GameState,
  GameSettings,
  Question,
  TeamData,
  ServerMessage,
} from "../types";

interface HostStore {
  // State from GameState
  gameCode: string | null;
  currentQuestionNumber: number;
  timerRunning: boolean;
  timerSecondsRemaining: number | null;
  gameSettings: GameSettings | null;
  questions: Question[];
  teams: TeamData[];
  /** The deck the server has attached to this game. */
  deck: DeckState | null;
  /** Event chosen when creating the game, waiting to be attached. */
  pendingDeckUuid: string | null;

  // Actions
  setPendingDeckUuid: (uuid: string | null) => void;
  setGameState: (state: GameState) => void;
  setTimerSecondsRemaining: (seconds: number) => void;
  clearGame: () => void;
}

export const useHostStore = create<HostStore>((set) => ({
  // Initial state
  gameCode: null,
  currentQuestionNumber: 0,
  timerRunning: false,
  timerSecondsRemaining: null,
  gameSettings: null,
  questions: [],
  teams: [],
  deck: null,
  pendingDeckUuid: null,

  // Actions
  setPendingDeckUuid: (uuid) => set({ pendingDeckUuid: uuid }),

  setGameState: (state: GameState) =>
    set({
      deck: state.deck ?? null,
      gameCode: state.gameCode,
      currentQuestionNumber: state.currentQuestionNumber,
      timerRunning: state.timerRunning,
      timerSecondsRemaining: state.timerSecondsRemaining,
      gameSettings: state.gameSettings,
      questions: state.questions,
      teams: state.teams,
    }),

  setTimerSecondsRemaining: (seconds: number) =>
    set({
      timerSecondsRemaining: seconds,
    }),

  clearGame: () =>
    set({
      gameCode: null,
      currentQuestionNumber: 0,
      timerRunning: false,
      timerSecondsRemaining: null,
      gameSettings: null,
      questions: [],
      teams: [],
      deck: null,
      pendingDeckUuid: null,
    }),
}));

/**
 * Subscribe to WebSocket messages relevant to the host.
 * Call in useEffect and return the unsubscribe function.
 */
export function subscribeToHostMessages() {
  return webSocketService.onMessage((message: ServerMessage) => {
    const { setGameState, setTimerSecondsRemaining } = useHostStore.getState();

    switch (message.type) {
      case "gameState":
        setGameState(message.state);
        break;
      case "timerTick":
        setTimerSecondsRemaining(message.secondsRemaining);
        break;
      case "error":
        // Rollback state if provided
        if (message.state) {
          setGameState(message.state);
        }
        break;
    }
  });
}
