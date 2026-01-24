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
import TeamHeader from "./components/TeamHeader";
import JoinStep from "./components/JoinStep";
import MembersStep from "./components/MembersStep";
import ColorStep from "./components/ColorStep";
import TeamGameView from "./components/TeamGameView";

export default function TeamFlow() {
  const navigate = useNavigate();
  const { connectionState, send, connectAndSend, disconnect } = useWebSocket();
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      webSocketService.clearInitialMessage();
      disconnect();
      reset();
    };
  }, [disconnect, reset]);

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

    // Use connectAndSend for atomic connection + validation
    const attemptRejoin = async () => {
      try {
        await connectAndSend({
          team: {
            validateJoin: {
              gameCode: rejoinData.gameCode,
              teamName: rejoinData.teamName,
            },
          },
        });
        // Success - message handlers will update store
      } catch (error) {
        console.error("Failed to rejoin game:", error);
        clearTeamRejoin();
        setIsRejoining(false);
        reset();
        navigate("/");
      }
    };
    attemptRejoin();
  }, [connectAndSend, setGameCode, setTeamName, reset, navigate]);

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
        // reconnect() replays the stored initial message automatically
        await webSocketService.reconnect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
        webSocketService.clearInitialMessage();
        disconnect();
        reset();
        navigate("/");
        break;
      case "members":
        // Disconnect so next attempt starts fresh (server expects JoinGame, not ValidateJoin)
        webSocketService.clearInitialMessage();
        disconnect();
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

    const filledMembers = teamMembers
      .map((m) => m.trim())
      .filter((m) => m !== "");

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

      {(connectionState === "disconnected" || connectionState === "connected") && (
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
