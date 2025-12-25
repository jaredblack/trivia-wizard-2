import { useEffect, useState, useCallback } from "react";
import {
  webSocketService,
  type ConnectionState,
} from "../services/websocket";
import type { ClientMessage, ServerMessage } from "../types";
import { useHostStore } from "../stores/useHostStore";

export function useWebSocket() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    webSocketService.connectionState
  );

  const setGameState = useHostStore((state) => state.setGameState);
  const setTimerSecondsRemaining = useHostStore(
    (state) => state.setTimerSecondsRemaining
  );

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
            break;
          case "error":
            console.error("Server error:", message.message);
            // Optionally rollback state if provided
            if (message.state) {
              setGameState(message.state);
            }
            break;
          case "teamGameState":
            // Host doesn't use team game state
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
  }, [setGameState, setTimerSecondsRemaining]);

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
