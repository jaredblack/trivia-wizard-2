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

  // Stored message for automatic reconnection replay
  private initialMessage: ClientMessage | null = null;

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: ConnectionState) {
    this._connectionState = state;
    this.stateChangeHandlers.forEach((handler) => handler(state));
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

  /**
   * Atomically connect and send an initial message.
   * - Sets state to "connecting"
   * - Opens WebSocket, waits for onopen
   * - Sends message immediately
   * - Waits for first response:
   *   - If `error` message → disconnect, throw error
   *   - If any other message → transition to "connected", resolve
   *   - If 2s timeout → disconnect, throw timeout error
   * - Stores the message for automatic reconnection replay
   */
  async connectAndSend(message: ClientMessage): Promise<void> {
    // Store message for reconnection
    this.initialMessage = message;
    this.intentionalDisconnect = false;

    // Already connected - just send the message
    if (this.ws && this._connectionState === "connected") {
      return this.sendAndAwaitResponse(message);
    }

    // Close any existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setConnectionState("connecting");

    try {
      const url = await buildWsUrl();
      this.ws = new WebSocket(url);

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
          this.setConnectionState("disconnected");
          reject(new Error("WebSocket connection timeout"));
        }, 10000);

        this.ws!.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };

        this.ws!.onerror = () => {
          clearTimeout(timeout);
          this.setConnectionState("error");
          reject(new Error("WebSocket connection failed"));
        };

        this.ws!.onclose = () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket closed during connection"));
        };
      });

      // Attach permanent handlers
      this.ws!.onmessage = (event) => {
        console.log("Message from server:", event.data);
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          this.messageHandlers.forEach((handler) => handler(msg));
        } catch {
          console.log("Non-JSON message from server:", event.data);
        }
      };

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

      // Now send message and await response
      await this.sendAndAwaitResponse(message);

      console.log("WebSocket connected and initial message succeeded");
      this.setConnectionState("connected");
    } catch (error) {
      this.initialMessage = null;
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.setConnectionState("disconnected");
      throw error;
    }
  }

  private sendAndAwaitResponse(message: ClientMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timeout waiting for server response"));
      }, 2000);

      const handleMessage = (msg: ServerMessage) => {
        clearTimeout(timeout);
        unsubscribe();
        if (msg.type === "error") {
          reject(new Error(msg.message));
        } else {
          resolve();
        }
      };

      const unsubscribe = this.onMessage(handleMessage);

      // Send the message
      console.log("Sending message:", message);
      this.ws!.send(JSON.stringify(message));
    });
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

  /**
   * Clear the stored initial message (e.g., when leaving a game).
   */
  clearInitialMessage(): void {
    this.initialMessage = null;
  }

  /**
   * Manually trigger reconnection (e.g., after visibility change).
   * Replays the stored initial message if available.
   */
  async reconnect(): Promise<void> {
    this.intentionalDisconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    await this.startReconnection();
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

          this.ws!.onopen = async () => {
            clearTimeout(timeout);
            console.log("WebSocket reconnected");

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

            // Replay the initial message if stored
            if (this.initialMessage) {
              try {
                console.log("Replaying initial message for reconnection...");
                await this.sendAndAwaitResponse(this.initialMessage);
                console.log("Reconnection message replay succeeded");
              } catch (error) {
                console.error("Reconnection message replay failed:", error);
                // Transition to error state and stop reconnection
                this.setConnectionState("error");
                this.reconnectAttempt = 0;
                return;
              }
            }

            this.setConnectionState("connected");
            this.reconnectAttempt = 0;

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
