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
  const setTeamIsValidating = useTeamStore((state) => state.setIsValidating);
  const setTeamColor = useTeamStore((state) => state.setColor);
  const setTeamMembers = useTeamStore((state) => state.setTeamMembers);

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
          case "joinValidated":
            // Validation passed - advance to members step
            setTeamIsValidating(false);
            setTeamStep("members");
            break;
          case "error":
            console.error("Server error:", message.message);
            // Handle error for host (rollback state if provided)
            if (message.state) {
              setGameState(message.state);
            }
            // Handle error for team (show error, stop validating, go back to join step)
            setTeamIsValidating(false);
            setTeamError(message.message);
            setTeamStep("join");
            break;
          case "teamGameState": {
            // Check if this is a rejoin response (still on join step, isValidating)
            const currentStep = useTeamStore.getState().step;
            const isValidating = useTeamStore.getState().isValidating;

            if (currentStep === "join" && isValidating) {
              // Rejoin scenario - populate store from returned team data
              // Backend handles the rejoin directly, no need to send JoinGame
              const teamData = message.state.team;
              setTeamColor({
                hex: teamData.teamColor.hexCode,
                name: teamData.teamColor.name,
              });
              setTeamMembers(teamData.teamMembers);
            }

            setTeamIsValidating(false);
            // Update team store with game state (this also sets step to "game")
            setTeamGameState(message.state);
            break;
          }
        }
      }
    );

    // Sync initial state
    setConnectionState(webSocketService.connectionState);

    return () => {
      unsubscribeState();
      unsubscribeMessage();
    };
  }, [setGameState, setTimerSecondsRemaining, setTeamGameState, setTeamTimerSecondsRemaining, setTeamError, setTeamStep, setTeamIsValidating, setTeamColor, setTeamMembers]);

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
