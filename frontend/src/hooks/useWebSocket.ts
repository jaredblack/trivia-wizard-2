import { useEffect, useState, useCallback } from "react";
import {
  webSocketService,
  type ConnectionState,
} from "../services/websocket";
import type { ClientMessage } from "../types";

/**
 * Hook for WebSocket connection management.
 * Message handling is done separately via store subscriptions.
 */
export function useWebSocket() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    webSocketService.connectionState
  );

  useEffect(() => {
    const unsubscribe = webSocketService.onStateChange((state) => {
      setConnectionState(state);
    });

    // Sync initial state
    setConnectionState(webSocketService.connectionState);

    return unsubscribe;
  }, []);

  const send = useCallback((message: ClientMessage) => {
    webSocketService.send(message);
  }, []);

  const connectAndSend = useCallback(async (message: ClientMessage) => {
    await webSocketService.connectAndSend(message);
  }, []);

  const disconnect = useCallback(() => {
    webSocketService.disconnect();
  }, []);

  return {
    connectionState,
    send,
    connectAndSend,
    disconnect,
  };
}
