import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useTeamStore } from "../../stores/useTeamStore";
import {
  getTeamRejoin,
  saveTeamRejoin,
  clearTeamRejoin,
} from "../../utils/rejoinStorage";
import Toast from "../../components/ui/Toast";
import ReconnectionToast from "../../components/ui/ReconnectionToast";
import { webSocketService } from "../../services/websocket";
import type { ServerMessage } from "../../types";
import TeamHeader from "./components/TeamHeader";
import JoinStep from "./components/JoinStep";
import MembersStep from "./components/MembersStep";
import ColorStep from "./components/ColorStep";
import TeamGameView from "./components/TeamGameView";

export default function TeamFlow() {
  const navigate = useNavigate();
  const { connectionState, send, connect, disconnect } = useWebSocket();
  const {
    step,
    gameCode,
    teamName,
    teamMembers,
    selectedColor,
    error,
    setStep,
    setGameCode,
    setTeamName,
    setError,
    reset,
  } = useTeamStore();

  const [isRejoining, setIsRejoining] = useState(false);
  const hasAttemptedRejoin = useRef(false);

  // Connect WebSocket on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
      reset();
    };
  }, [connect, disconnect, reset]);

  // Auto-rejoin: check for saved team data on mount
  useEffect(() => {
    if (hasAttemptedRejoin.current) return;

    const rejoinData = getTeamRejoin();
    if (!rejoinData) return;

    hasAttemptedRejoin.current = true;
    setIsRejoining(true);

    // Populate store with saved data
    setGameCode(rejoinData.gameCode);
    setTeamName(rejoinData.teamName);

    // Wait for connection then send validateJoin message
    const attemptRejoin = async () => {
      try {
        await connect();
        send({
          team: {
            validateJoin: {
              gameCode: rejoinData.gameCode,
              teamName: rejoinData.teamName,
            },
          },
        });
      } catch (error) {
        console.error("Failed to rejoin game:", error);
        clearTeamRejoin();
        setIsRejoining(false);
        reset();
        navigate("/");
      }
    };
    attemptRejoin();
  }, [connect, send, setGameCode, setTeamName, reset, navigate]);

  // Save team data when successfully joined (step becomes "game")
  useEffect(() => {
    if (step === "game") {
      saveTeamRejoin({
        gameCode: gameCode.trim(),
        teamName: teamName.trim(),
      });
      setIsRejoining(false);
    }
  }, [step, gameCode, teamName]);

  // Clear storage on error during rejoin
  useEffect(() => {
    if (isRejoining && error) {
      clearTeamRejoin();
      setIsRejoining(false);
    }
  }, [isRejoining, error]);

  // Register reconnection callback when in game step.
  // This sends validateJoin and waits for TeamGameState before the connection
  // transitions to "connected", preventing any race conditions where other
  // messages could be sent before validation completes.
  // Note: The TeamGameState is still processed by the handler in useWebSocket.ts
  // since onMessage calls ALL registered handlers via forEach.
  useEffect(() => {
    if (step !== "game") {
      webSocketService.setReconnectionCallback(null);
      return;
    }

    const reconnectionCallback = async (): Promise<void> => {
      const rejoinData = getTeamRejoin();
      if (!rejoinData) {
        console.warn("No rejoin data available during reconnection");
        return;
      }

      console.log("Reconnection callback: sending validateJoin...");

      // Create a promise that resolves when we receive TeamGameState or error
      return new Promise<void>((resolve) => {
        const handleMessage = (message: ServerMessage) => {
          if (message.type === "teamGameState" || message.type === "error") {
            console.log("Reconnection callback: received response:", message.type);
            unsubscribe();
            resolve();
          }
        };

        const unsubscribe = webSocketService.onMessage(handleMessage);

        // Send validateJoin - this works because the WebSocket is open,
        // even though connection state is still "reconnecting"
        send({
          team: {
            validateJoin: {
              gameCode: rejoinData.gameCode,
              teamName: rejoinData.teamName,
            },
          },
        });

        // Timeout fallback in case response never comes
        setTimeout(() => {
          console.warn("Reconnection callback: timeout waiting for response");
          unsubscribe();
          resolve();
        }, 5000);
      });
    };

    webSocketService.setReconnectionCallback(reconnectionCallback);

    return () => {
      webSocketService.setReconnectionCallback(null);
    };
  }, [step, send]);

  // Handle reconnection failure: show error and redirect
  useEffect(() => {
    if (connectionState === "error" && step === "game") {
      setError("Unable to reconnect. Please rejoin the game.");
      clearTeamRejoin();
      reset();
      navigate("/");
    }
  }, [connectionState, step, setError, reset, navigate]);

  // Handle visibility change: disconnect when hidden, reconnect when visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        disconnect();
      } else if (step === "game") {
        const rejoinData = getTeamRejoin();
        if (rejoinData) {
          try {
            // Use reconnect() which goes through the reconnection flow
            // including invoking the reconnection callback
            await webSocketService.reconnect();
          } catch (error) {
            console.error("Failed to reconnect after visibility change:", error);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [disconnect, step]);

  const handleCancelReconnection = useCallback(() => {
    webSocketService.cancelReconnection();
    clearTeamRejoin();
    disconnect();
    reset();
    navigate("/");
  }, [disconnect, reset, navigate]);

  const handleBack = useCallback(() => {
    switch (step) {
      case "join":
        clearTeamRejoin();
        disconnect();
        reset();
        navigate("/");
        break;
      case "members":
        setStep("join");
        break;
      case "color":
        setStep("members");
        break;
      case "game":
        // No back navigation from game view
        break;
    }
  }, [step, disconnect, reset, navigate, setStep]);

  const handleJoinGame = useCallback(() => {
    if (!selectedColor) return;

    const filledMembers = teamMembers.filter((m) => m.trim() !== "");

    send({
      team: {
        joinGame: {
          gameCode: gameCode.trim(),
          teamName: teamName.trim(),
          colorHex: selectedColor.hex,
          colorName: selectedColor.name,
          teamMembers: filledMembers,
        },
      },
    });
  }, [send, gameCode, teamName, teamMembers, selectedColor]);

  const handleDismissError = useCallback(() => {
    setError(null);
  }, [setError]);

  // Show game view without header
  if (step === "game") {
    return (
      <div className="px-4">
        {error && <Toast message={error} onClose={handleDismissError} />}
        {connectionState === "reconnecting" && (
          <ReconnectionToast onCancel={handleCancelReconnection} />
        )}
        <TeamGameView />
      </div>
    );
  }

  // Show join flow with header
  return (
    <div className="min-h-screen flex flex-col">
      {error && <Toast message={error} onClose={handleDismissError} />}
      <TeamHeader onBack={handleBack} />

      {connectionState === "connecting" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">Connecting...</p>
        </div>
      )}

      {connectionState === "error" && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-red-500 text-center">
            Failed to connect. Please try again.
          </p>
        </div>
      )}

      {connectionState === "connected" && (
        <div className="flex-1 flex flex-col px-6">
          {isRejoining ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-500">Rejoining game...</p>
            </div>
          ) : (
            <>
              {step === "join" && <JoinStep />}
              {step === "members" && <MembersStep />}
              {step === "color" && <ColorStep onJoinGame={handleJoinGame} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
