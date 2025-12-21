import { useNavigate } from "react-router-dom";
import { useHostStore } from "../../stores/useHostStore";
import QuestionControls from "./components/QuestionControls";
import AnswerList from "./components/AnswerList";
import Scoreboard from "./components/Scoreboard";
import GameSettings from "./components/GameSettings";
import type { QuestionKind } from "../../types";

export default function HostGame() {
  const navigate = useNavigate();
  const {
    gameCode,
    currentQuestionNumber,
    currentQuestion,
    teams,
    clearGame,
  } = useHostStore();

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
    clearGame();
    navigate("/host");
  };

  // Derive question type from questionData
  const questionType: QuestionKind = currentQuestion.questionData.type;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header with question controls */}
      <QuestionControls
        questionNumber={currentQuestionNumber}
        questionType={questionType}
        timerDuration={currentQuestion.timerDuration}
        onExit={handleExit}
      />

      {/* Main content area */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left panel - Answer list (60%) */}
        <div className="w-3/5 border-r border-gray-200 overflow-y-auto">
          <AnswerList
            question={currentQuestion}
            teams={teams}
            onTeamScoreChange={(teamName, score) => {
              // TODO: Update team score in store and sync with server
              console.log("Score change:", teamName, score);
            }}
          />
        </div>

        {/* Right panel - Scoreboard (40%) */}
        <div className="w-2/5 overflow-y-auto">
          <Scoreboard gameCode={gameCode} teams={teams} />
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
        onOpenSettings={() => {
          // TODO: Open settings modal
          console.log("Open settings");
        }}
      />
    </div>
  );
}
