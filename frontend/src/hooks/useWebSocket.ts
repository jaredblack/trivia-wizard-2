import { useEffect, useState, useCallback } from "react";
import {
  webSocketService,
  type ConnectionState,
} from "../services/websocket";
import type { ClientMessage, ServerMessage } from "../types";
import { useHostStore } from "../stores/useHostStore";
import { useTeamStore } from "../stores/useTeamStore";

export function useWebSocket() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    webSocketService.connectionState
  );

  const setGameState = useHostStore((state) => state.setGameState);
  const setTimerSecondsRemaining = useHostStore(
    (state) => state.setTimerSecondsRemaining
  );

  // Team store actions
  const setTeamGameState = useTeamStore((state) => state.setTeamGameState);
  const setTeamTimerSecondsRemaining = useTeamStore(
    (state) => state.setTimerSecondsRemaining
  );
  const setTeamError = useTeamStore((state) => state.setError);
  const setTeamStep = useTeamStore((state) => state.setStep);

  useEffect(() => {
    // Subscribe to connection state changes
    const unsubscribeState = webSocketService.onStateChange((state) => {
      setConnectionState(state);
    });

    // Subscribe to messages and route to store
    const unsubscribeMessage = webSocketService.onMessage(
      (message: ServerMessage) => {
        switch (message.type) {
          case "gameState":
            setGameState(message.state);
            break;
          case "timerTick":
            setTimerSecondsRemaining(message.secondsRemaining);
            setTeamTimerSecondsRemaining(message.secondsRemaining);
            break;
          case "error":
            console.error("Server error:", message.message);
            // Handle error for host (rollback state if provided)
            if (message.state) {
              setGameState(message.state);
            }
            // Handle error for team (show error and go back to join step)
            setTeamError(message.message);
            setTeamStep("join");
            break;
          case "teamGameState":
            // Update team store with game state
            setTeamGameState(message.state);
            break;
        }
      }
    );

    // Sync initial state
    setConnectionState(webSocketService.connectionState);

    return () => {
      unsubscribeState();
      unsubscribeMessage();
    };
  }, [setGameState, setTimerSecondsRemaining, setTeamGameState, setTeamTimerSecondsRemaining, setTeamError, setTeamStep]);

  const send = useCallback((message: ClientMessage) => {
    webSocketService.send(message);
  }, []);

  const connect = useCallback(async () => {
    await webSocketService.connect();
  }, []);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
  }, []);

  return {
    connectionState,
    send,
    connect,
    disconnect,
  };
}
