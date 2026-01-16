import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTeamStore } from "../../../stores/useTeamStore";
import { webSocketService } from "../../../services/websocket";
import { clearTeamRejoin } from "../../../utils/rejoinStorage";
import TimerDisplay from "../../../components/ui/TimerDisplay";
import Button from "../../../components/ui/Button";
import ConfirmationModal from "../../../components/ui/ConfirmationModal";
import TeamHeader from "./TeamHeader";
import ScoreLogDrawer from "./ScoreLogDrawer";
import StandardAnswerInput from "./StandardAnswerInput";
import MultipleChoiceAnswerInput from "./MultipleChoiceAnswerInput";
import { getScore, getMcOptions, answerToString } from "../../../types";

export default function TeamGameView() {
  const navigate = useNavigate();
  const { teamGameState, gameCode, reset } = useTeamStore();
  const [draftAnswer, setDraftAnswer] = useState("");
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showScoreLog, setShowScoreLog] = useState(false);

  const currentQuestionNumber = teamGameState?.currentQuestionNumber;
  const timerRunning = teamGameState?.timerRunning;
  const currentQuestion =
    teamGameState && currentQuestionNumber
      ? teamGameState.questions[currentQuestionNumber - 1]
      : undefined;
  const content = currentQuestion?.content;
  const hasAnswer = content != null;

  // Reset timerHasOpened and draftAnswer when question changes
  useEffect(() => {
    setDraftAnswer("");
  }, [currentQuestionNumber]);

  // Auto-submit when timer reaches 0 (not when host closes early)
  const timerSecondsRemaining = teamGameState?.timerSecondsRemaining;
  const teamName = teamGameState?.team.teamName;
  useEffect(() => {
    if (timerSecondsRemaining === 0 && !hasAnswer && draftAnswer.trim() && teamName) {
      webSocketService.send({
        team: {
          submitAnswer: {
            teamName,
            answer: draftAnswer.trim(),
          },
        },
      });
    }
  }, [timerSecondsRemaining, hasAnswer, draftAnswer, teamName]);

  if (!teamGameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const { team } = teamGameState;

  // Get question type and config from current question
  const questionKind = currentQuestion?.questionKind ?? "standard";
  const questionConfig = currentQuestion?.questionConfig;

  // Get the submitted answer text (for any content type)
  const submittedAnswerText = content ? answerToString(content) : null;

  const handleSubmitAnswer = () => {
    if (!draftAnswer.trim()) return;

    webSocketService.send({
      team: {
        submitAnswer: {
          teamName: team.teamName,
          answer: draftAnswer.trim(),
        },
      },
    });
  };

  const handleStubButton = (feature: string) => {
    console.log(`${feature} - Coming soon!`);
  };

  const handleLeaveGame = () => {
    clearTeamRejoin();
    webSocketService.disconnect();
    reset();
    navigate("/");
  };

  // Timer display value (default to 0 if null)
  const timerSeconds = timerSecondsRemaining ?? 0;

  const renderContent = () => {
    // View A: Submissions not yet open
    if (!timerRunning && timerSeconds > 0 && !hasAnswer) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center">
          <p className="text-base text-gray-600 text-center">
            Submissions are not yet open
          </p>
        </div>
      );
    }

    // View B: Answer input
    if (timerRunning && !hasAnswer) {
      // Multiple choice input
      if (
        questionKind === "multipleChoice" &&
        questionConfig?.type === "multipleChoice"
      ) {
        const options = getMcOptions(questionConfig.config);
        return (
          <MultipleChoiceAnswerInput
            options={options}
            selectedOption={draftAnswer || null}
            onSelectOption={setDraftAnswer}
            onSubmit={handleSubmitAnswer}
            teamColor={team.teamColor.hexCode}
          />
        );
      }

      // Standard text input (default)
      return (
        <StandardAnswerInput
          draftAnswer={draftAnswer}
          onDraftChange={setDraftAnswer}
          onSubmit={handleSubmitAnswer}
          teamColor={team.teamColor.hexCode}
        />
      );
    }

    // View C: Submissions closed (all other cases)
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <p className="text-base text-gray-600 text-center">
          Submissions closed.
        </p>
        <p className="italic text-center">Your answer:</p>
        <p className="text-center">{submittedAnswerText ?? "You didn't submit anything :("}</p>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TeamHeader onBack={() => setShowLeaveModal(true)} />

      {showLeaveModal && (
        <ConfirmationModal
          title="Leave game?"
          message="Are you sure you want to leave the game?"
          confirmLabel="Leave"
          onConfirm={handleLeaveGame}
          onCancel={() => setShowLeaveModal(false)}
        />
      )}

      <ScoreLogDrawer
        isOpen={showScoreLog}
        onClose={() => setShowScoreLog(false)}
        teamName={team.teamName}
        totalScore={team.score}
        questions={teamGameState.questions}
      />

      {/* Game Info Header */}
      <div className="flex items-end justify-between px-4 py-3">
        {/* Left side: Team info + Question number */}
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: team.teamColor.hexCode }}
              />
              <span className="text-md">{team.teamName}</span>
            </div>
          <span className="text-2xl font-bold">Question {currentQuestionNumber}</span>
        </div>

        {/* Right side: Timer */}
        <div className="flex flex-col align-end">
          <span className="text-md">Game code: {gameCode}</span>
          <span className="text-md ml-auto">Score: {getScore(teamGameState.team.score)}</span>
          <TimerDisplay seconds={timerSeconds} className="text-4xl ml-auto" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col px-4 py-6">
        {renderContent()}
      </div>

      {/* Footer buttons (shown when not in answer input mode) */}
      {(!timerRunning || hasAnswer) && (
        <div className="p-4 flex gap-3">
          <Button
            variant="primary"
            onClick={() => setShowScoreLog(true)}
            className="flex-1"
          >
            View Score Log
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleStubButton("Team Settings")}
            className="flex-1"
          >
            Team Settings
          </Button>
        </div>
      )}
    </div>
  );
}
