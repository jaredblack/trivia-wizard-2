import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useHostStore } from "../../stores/useHostStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import QuestionControls from "./components/QuestionControls";
import AnswerList from "./components/AnswerList";
import Scoreboard from "./components/Scoreboard";
import GameSettings from "./components/GameSettings";
import SettingsModal from "./components/SettingsModal";
import type { QuestionKind, ClientMessage } from "../../types";

export default function HostGame() {
  const navigate = useNavigate();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    gameCode,
    currentQuestionNumber,
    timerRunning,
    timerSecondsRemaining,
    questions,
    gameSettings,
    teams,
    clearGame,
  } = useHostStore();
  const { connectionState, send, disconnect } = useWebSocket();

  // Get current question from questions array (0-indexed)
  const currentQuestion = questions[currentQuestionNumber - 1] ?? null;

  // Redirect if WebSocket disconnected
  useEffect(() => {
    if (connectionState === "disconnected" || connectionState === "error") {
      // Only redirect if we had a game but lost connection
      if (gameCode) {
        console.log("WebSocket disconnected, redirecting to host landing");
      }
    }
  }, [connectionState, gameCode]);

  // If no game data, redirect to host landing
  if (!gameCode || !currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">No active game</p>
          <button
            onClick={() => navigate("/host")}
            className="text-blue-600 hover:underline"
          >
            Return to Host Landing
          </button>
        </div>
      </div>
    );
  }

  const handleExit = () => {
    disconnect();
    clearGame();
    navigate("/host");
  };

  const sendMessage = (msg: ClientMessage) => {
    send(msg);
  };

  // Derive question type from questionData
  const questionType: QuestionKind = currentQuestion.questionData.type;

  // Timer display uses server state, falling back to question default
  const displaySeconds = timerSecondsRemaining ?? currentQuestion.timerDuration;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with question controls */}
      <QuestionControls
        questionNumber={currentQuestionNumber}
        questionType={questionType}
        timerSeconds={displaySeconds}
        timerRunning={timerRunning}
        onStartTimer={() => sendMessage({ host: { type: "startTimer" } })}
        onPauseTimer={() => sendMessage({ host: { type: "pauseTimer" } })}
        onResetTimer={() => sendMessage({ host: { type: "resetTimer" } })}
        onExit={handleExit}
      />

      {/* Main content area */}
      <main className="flex-1 flex overflow-hidden mx-12">
        <div className="flex-1 border-r border-gray-200 overflow-y-auto">
          <AnswerList
            question={currentQuestion}
            questionNumber={currentQuestionNumber}
            teams={teams}
            onScoreAnswer={(teamName, score) => {
              sendMessage({
                host: {
                  type: "scoreAnswer",
                  questionNumber: currentQuestionNumber,
                  teamName,
                  score,
                },
              });
            }}
          />
        </div>

        <div className="w-md shrink-0 overflow-y-auto">
          <Scoreboard
            gameCode={gameCode}
            teams={teams}
            onOverrideScore={(teamName, overridePoints) => {
              sendMessage({
                host: {
                  type: "overrideTeamScore",
                  teamName,
                  overridePoints,
                },
              });
            }}
          />
        </div>
      </main>

      {/* Footer with game settings */}
      <GameSettings
        questionPoints={currentQuestion.questionPoints}
        bonusIncrement={currentQuestion.bonusIncrement}
        timerLength={currentQuestion.timerDuration}
        onQuestionPointsChange={(value) => {
          // TODO: Update in store
          console.log("Question points:", value);
        }}
        onBonusIncrementChange={(value) => {
          // TODO: Update in store
          console.log("Bonus increment:", value);
        }}
        onTimerLengthChange={(value) => {
          // TODO: Update in store
          console.log("Timer length:", value);
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Settings Modal */}
      {isSettingsOpen && gameSettings && (
        <SettingsModal
          settings={gameSettings}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChange={(newSettings) => {
            // TODO: Update settings in store and sync with server
            console.log("Settings changed:", newSettings);
          }}
        />
      )}
    </div>
  );
}
