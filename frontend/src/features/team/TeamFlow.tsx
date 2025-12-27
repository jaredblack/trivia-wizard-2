import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useTeamStore } from "../../stores/useTeamStore";
import Toast from "../../components/ui/Toast";
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
    setError,
    reset,
  } = useTeamStore();

  // Connect WebSocket on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
      reset();
    };
  }, [connect, disconnect, reset]);

  const handleBack = useCallback(() => {
    switch (step) {
      case "join":
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
      <>
        {error && <Toast message={error} onClose={handleDismissError} />}
        <TeamGameView />
      </>
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
        <>
          {step === "join" && <JoinStep />}
          {step === "members" && <MembersStep />}
          {step === "color" && <ColorStep onJoinGame={handleJoinGame} />}
        </>
      )}
    </div>
  );
}
