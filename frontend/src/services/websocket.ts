import { fetchAuthSession } from "aws-amplify/auth";
import { isLocalMode, wsUrl } from "../config";
import type { ClientMessage, ServerMessage } from "../types";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
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
    return wsUrl;
  }
  return `${wsUrl}?token=${encodeURIComponent(token)}`;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private stateChangeHandlers: Set<StateChangeHandler> = new Set();
  private _connectionState: ConnectionState = "disconnected";
  private intentionalDisconnect = false;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: ConnectionState) {
    this._connectionState = state;
    this.stateChangeHandlers.forEach((handler) => handler(state));
  }

  async connect(): Promise<void> {
    // Reset intentional disconnect flag when explicitly connecting
    this.intentionalDisconnect = false;

    // Already connected
    if (this.ws && this._connectionState === "connected") {
      return;
    }

    // Connection already in progress - wait for it
    if (this.ws && this._connectionState === "connecting") {
      return new Promise<void>((resolve, reject) => {
        const checkConnection = () => {
          if (this._connectionState === "connected") {
            resolve();
          } else if (
            this._connectionState === "error" ||
            this._connectionState === "disconnected"
          ) {
            reject(new Error("WebSocket connection failed"));
          } else {
            setTimeout(checkConnection, 50);
          }
        };
        checkConnection();
      });
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
        this.ws = null;

        // If this was not an intentional disconnect, attempt reconnection
        if (!this.intentionalDisconnect) {
          this.startReconnection();
        } else {
          this.setConnectionState("disconnected");
        }
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
    this.intentionalDisconnect = true;
    this.cancelReconnection();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected");
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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

  cancelReconnection(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    this.reconnectAttempt = 0;
  }

  private async startReconnection(): Promise<void> {
    this.setConnectionState("reconnecting");
    this.reconnectAttempt = 0;

    const attemptReconnect = async (): Promise<void> => {
      // Check if reconnection was cancelled
      if (this.intentionalDisconnect) {
        this.setConnectionState("disconnected");
        return;
      }

      this.reconnectAttempt++;
      console.log(
        `Reconnection attempt ${this.reconnectAttempt}/${this.maxReconnectAttempts}`
      );

      try {
        const url = await buildWsUrl();
        this.ws = new WebSocket(url);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            // Close the WebSocket to prevent late connection
            if (this.ws) {
              this.ws.close();
              this.ws = null;
            }
            reject(new Error("WebSocket connection timeout"));
          }, 5000);

          this.ws!.onopen = () => {
            clearTimeout(timeout);
            console.log("WebSocket reconnected");
            this.setConnectionState("connected");
            this.reconnectAttempt = 0;

            // Re-attach message handler
            this.ws!.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data) as ServerMessage;
                this.messageHandlers.forEach((handler) => handler(message));
              } catch {
                console.log("Non-JSON message from server:", event.data);
              }
            };

            // Re-attach close handler
            this.ws!.onclose = (event) => {
              console.log("WebSocket disconnected", event.code, event.reason);
              this.ws = null;
              if (!this.intentionalDisconnect) {
                this.startReconnection();
              } else {
                this.setConnectionState("disconnected");
              }
            };

            this.ws!.onerror = (error) => {
              console.error("WebSocket error:", error);
            };

            resolve();
          };

          this.ws!.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket connection failed"));
          };

          this.ws!.onclose = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket closed during connection"));
          };
        });
      } catch (error) {
        console.log(`Reconnection attempt ${this.reconnectAttempt} failed: ${error}`);
        this.ws = null;

        if (this.reconnectAttempt < this.maxReconnectAttempts) {
          // Wait 500ms then try again
          await new Promise<void>((resolve) => {
            this.reconnectTimeoutId = setTimeout(() => {
              this.reconnectTimeoutId = null;
              resolve();
            }, 500);
          });
          await attemptReconnect();
        } else {
          // All attempts exhausted
          console.log("All reconnection attempts failed");
          this.setConnectionState("error");
          this.reconnectAttempt = 0;
        }
      }
    };

    await attemptReconnect();
  }
}

// Singleton instance
export const webSocketService = new WebSocketService();
