import { fetchAuthSession } from "aws-amplify/auth";
import { isLocalMode, wsUrl } from "../config";
import type { ClientMessage, ServerMessage } from "../types";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

type MessageHandler = (message: ServerMessage) => void;
type StateChangeHandler = (state: ConnectionState) => void;

async function buildWsUrl(): Promise<string> {
  if (isLocalMode) {
    return wsUrl;
  }
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error(
      "No access token available - user may not be authenticated"
    );
  }
  return `${wsUrl}?token=${encodeURIComponent(token)}`;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private stateChangeHandlers: Set<StateChangeHandler> = new Set();
  private _connectionState: ConnectionState = "disconnected";

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: ConnectionState) {
    this._connectionState = state;
    this.stateChangeHandlers.forEach((handler) => handler(state));
  }

  async connect(): Promise<void> {
    if (this.ws && this._connectionState === "connected") {
      return;
    }

    this.setConnectionState("connecting");

    try {
      const url = await buildWsUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log("WebSocket connected");
        this.setConnectionState("connected");
      };

      this.ws.onmessage = (event) => {
        console.log("Message from server:", event.data);
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          this.messageHandlers.forEach((handler) => handler(message));
        } catch {
          console.log("Non-JSON message from server:", event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log("WebSocket disconnected", event.code, event.reason);
        this.setConnectionState("disconnected");
        this.ws = null;
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.setConnectionState("error");
      };

      // Wait for connection to establish
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("WebSocket connection timeout"));
        }, 10000);

        const checkConnection = () => {
          if (this._connectionState === "connected") {
            clearTimeout(timeout);
            resolve();
          } else if (
            this._connectionState === "error" ||
            this._connectionState === "disconnected"
          ) {
            clearTimeout(timeout);
            reject(new Error("WebSocket connection failed"));
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    } catch (error) {
      this.setConnectionState("error");
      throw error;
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected");
  }

  send(message: ClientMessage): void {
    if (!this.ws || this._connectionState !== "connected") {
      console.error("Cannot send message: WebSocket not connected");
      return;
    }
    console.log("Sending message:", message);
    this.ws.send(JSON.stringify(message));
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }
}

// Singleton instance
export const webSocketService = new WebSocketService();
