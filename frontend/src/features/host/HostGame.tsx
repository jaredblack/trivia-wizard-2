import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useHostStore } from "../../stores/useHostStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import {
  getHostRejoin,
  clearHostRejoin,
} from "../../utils/rejoinStorage";
import QuestionControls from "./components/QuestionControls";
import AnswerList from "./components/AnswerList";
import Scoreboard from "./components/Scoreboard";
import GameSettings from "./components/GameSettings";
import SettingsModal from "./components/SettingsModal";
import type { QuestionKind, ClientMessage, HostClientMessage } from "../../types";

export default function HostGame() {
  const navigate = useNavigate();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRejoining, setIsRejoining] = useState(false);
  const hasAttemptedRejoin = useRef(false);
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
  const { connectionState, send, connect, disconnect } = useWebSocket();

  // Get current question from questions array (0-indexed)
  const currentQuestion = questions[currentQuestionNumber - 1] ?? null;

  // Auto-rejoin: check for saved game code on mount
  useEffect(() => {
    if (hasAttemptedRejoin.current) return;

    const rejoinData = getHostRejoin();
    if (!rejoinData) return;

    hasAttemptedRejoin.current = true;
    setIsRejoining(true);

    const attemptRejoin = async () => {
      try {
        await connect();
        const msg: HostClientMessage = {
          host: { type: "createGame", gameCode: rejoinData.gameCode },
        };
        send(msg);
      } catch (error) {
        console.error("Failed to rejoin game:", error);
        clearHostRejoin();
        setIsRejoining(false);
      }
    };
    attemptRejoin();
  }, [connect, send]);

  // Clear rejoin state when game data arrives
  useEffect(() => {
    if (gameCode && isRejoining) {
      setIsRejoining(false);
    }
  }, [gameCode, isRejoining]);

  // Handle rejoin failure (connection error)
  useEffect(() => {
    if (isRejoining && connectionState === "error") {
      clearHostRejoin();
      setIsRejoining(false);
    }
  }, [isRejoining, connectionState]);

  // If no game data and not rejoining, show fallback
  if (!gameCode || !currentQuestion) {
    if (isRejoining) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-gray-600">Refresh to reconnect to game...</p>
        </div>
      );
    }

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
    clearHostRejoin();
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

  // Check if the current question has any responses (used to disable settings)
  const questionHasAnswers = currentQuestion.questionData.responses.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with question controls */}
      <QuestionControls
        questionNumber={currentQuestionNumber}
        questionType={questionType}
        timerSeconds={displaySeconds}
        timerRunning={timerRunning}
        settingsDisabled={questionHasAnswers}
        onStartTimer={() => sendMessage({ host: { type: "startTimer" } })}
        onPauseTimer={() => sendMessage({ host: { type: "pauseTimer" } })}
        onResetTimer={() => sendMessage({ host: { type: "resetTimer" } })}
        onPrevQuestion={() => sendMessage({ host: { type: "prevQuestion" } })}
        onNextQuestion={() => sendMessage({ host: { type: "nextQuestion" } })}
        onQuestionTypeChange={(type) => {
          sendMessage({
            host: {
              type: "updateQuestionSettings",
              questionNumber: currentQuestionNumber,
              timerDuration: currentQuestion.timerDuration,
              questionPoints: currentQuestion.questionPoints,
              bonusIncrement: currentQuestion.bonusIncrement,
              questionType: type,
            },
          });
        }}
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
        disabled={questionHasAnswers}
        onQuestionPointsChange={(value) => {
          sendMessage({
            host: {
              type: "updateQuestionSettings",
              questionNumber: currentQuestionNumber,
              timerDuration: currentQuestion.timerDuration,
              questionPoints: value,
              bonusIncrement: currentQuestion.bonusIncrement,
              questionType: currentQuestion.questionData.type,
            },
          });
        }}
        onBonusIncrementChange={(value) => {
          sendMessage({
            host: {
              type: "updateQuestionSettings",
              questionNumber: currentQuestionNumber,
              timerDuration: currentQuestion.timerDuration,
              questionPoints: currentQuestion.questionPoints,
              bonusIncrement: value,
              questionType: currentQuestion.questionData.type,
            },
          });
        }}
        onTimerLengthChange={(value) => {
          sendMessage({
            host: {
              type: "updateQuestionSettings",
              questionNumber: currentQuestionNumber,
              timerDuration: value,
              questionPoints: currentQuestion.questionPoints,
              bonusIncrement: currentQuestion.bonusIncrement,
              questionType: currentQuestion.questionData.type,
            },
          });
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Settings Modal */}
      {isSettingsOpen && gameSettings && (
        <SettingsModal
          settings={gameSettings}
          onClose={() => setIsSettingsOpen(false)}
          onSettingsChange={(newSettings) => {
            sendMessage({
              host: {
                type: "updateGameSettings",
                defaultTimerDuration: newSettings.defaultTimerDuration,
                defaultQuestionPoints: newSettings.defaultQuestionPoints,
                defaultBonusIncrement: newSettings.defaultBonusIncrement,
                defaultQuestionType: newSettings.defaultQuestionType,
              },
            });
          }}
        />
      )}
    </div>
  );
}
