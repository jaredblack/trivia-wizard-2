import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useHostStore } from "../../stores/useHostStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import { webSocketService } from "../../services/websocket";
import {
  getHostRejoin,
  clearHostRejoin,
} from "../../utils/rejoinStorage";
import ReconnectionToast from "../../components/ui/ReconnectionToast";
import QuestionControls from "./components/QuestionControls";
import StandardMainArea from "./components/StandardMainArea";
import MultipleChoiceMainArea from "./components/MultipleChoiceMainArea";
import Scoreboard from "./components/Scoreboard";
import GameSettings from "./components/GameSettings";
import SettingsModal from "./components/SettingsModal";
import type { QuestionKind, ClientMessage, HostClientMessage, McConfig } from "../../types";
import { defaultMcConfig } from "../../types";

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
  const prevConnectionState = useRef(connectionState);

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
      clearGame();
      navigate("/host");
    }
  }, [isRejoining, connectionState, clearGame, navigate]);

  // Handle reconnection success: re-send createGame to restore server state
  useEffect(() => {
    if (
      prevConnectionState.current === "reconnecting" &&
      connectionState === "connected" &&
      gameCode
    ) {
      const rejoinData = getHostRejoin();
      if (rejoinData) {
        const msg: HostClientMessage = {
          host: { type: "createGame", gameCode: rejoinData.gameCode },
        };
        send(msg);
      }
    }
    prevConnectionState.current = connectionState;
  }, [connectionState, gameCode, send]);

  // Handle reconnection failure: redirect to host landing
  useEffect(() => {
    if (
      prevConnectionState.current === "reconnecting" &&
      connectionState === "error" &&
      gameCode
    ) {
      clearHostRejoin();
      clearGame();
      navigate("/host");
    }
  }, [connectionState, gameCode, clearGame, navigate]);

  const handleCancelReconnection = useCallback(() => {
    webSocketService.cancelReconnection();
    clearHostRejoin();
    disconnect();
    clearGame();
    navigate("/host");
  }, [disconnect, clearGame, navigate]);

  // If no game data, redirect to host landing
  useEffect(() => {
    if (!isRejoining && !gameCode) {
      navigate("/host");
    }
  }, [isRejoining, gameCode, navigate]);

  // Show loading while rejoining
  if (!gameCode || !currentQuestion) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Rejoining game...</p>
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

  // Derive question type from questionKind
  const questionType: QuestionKind = currentQuestion.questionKind;

  // Timer display uses server state, falling back to question default
  const displaySeconds = timerSecondsRemaining ?? currentQuestion.timerDuration;

  // Check if the current question has any answers (used to disable settings)
  const questionHasAnswers = currentQuestion.answers.length > 0;

  return (
    <div className="min-h-screen flex flex-col">
      {connectionState === "reconnecting" && (
        <ReconnectionToast onCancel={handleCancelReconnection} />
      )}
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
          {currentQuestion.questionKind === "multipleChoice" ? (
            <MultipleChoiceMainArea
              question={currentQuestion}
              questionNumber={currentQuestionNumber}
              teams={teams}
              mcConfig={
                currentQuestion.questionConfig.type === "multipleChoice"
                  ? currentQuestion.questionConfig.config
                  : defaultMcConfig
              }
              settingsDisabled={questionHasAnswers}
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
              onMcConfigChange={(config: McConfig) => {
                sendMessage({
                  host: {
                    type: "updateQuestionSettings",
                    questionNumber: currentQuestionNumber,
                    timerDuration: currentQuestion.timerDuration,
                    questionPoints: currentQuestion.questionPoints,
                    bonusIncrement: currentQuestion.bonusIncrement,
                    questionType: currentQuestion.questionKind,
                    mcConfig: config,
                  },
                });
              }}
            />
          ) : (
            <StandardMainArea
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
          )}
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
              questionType: currentQuestion.questionKind,
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
              questionType: currentQuestion.questionKind,
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
              questionType: currentQuestion.questionKind,
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
                defaultMcConfig: newSettings.defaultMcConfig,
              },
            });
          }}
        />
      )}
    </div>
  );
}
