import { useEffect, useState } from "react";
import { useTeamStore } from "../../../stores/useTeamStore";
import { webSocketService } from "../../../services/websocket";
import TimerDisplay from "../../../components/ui/TimerDisplay";
import Button from "../../../components/ui/Button";

export default function TeamGameView() {
  const { teamGameState } = useTeamStore();
  const [draftAnswer, setDraftAnswer] = useState("");

  if (!teamGameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const {
    team,
    currentQuestionNumber,
    timerRunning,
    timerSecondsRemaining,
    currentQuestionData,
  } = teamGameState;

  // Determine if team has submitted an answer for current question
  const hasAnswer = currentQuestionData.response !== null;

  // Get the submitted answer text (for Standard type)
  const submittedAnswerText =
    currentQuestionData.type === "standard"
      ? currentQuestionData.response?.answerText
      : null;

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
    alert(`${feature} - Coming soon!`);
  };

  // Timer display value (default to 0 if null)
  const timerSeconds = timerSecondsRemaining ?? 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Logo Header - centered */}
      <header className="p-4 text-center">
        <h1 className="text-2xl font-bold">
          Trivia Wizard{" "}
          <span style={{ fontFamily: "Birthstone" }} className="text-3xl">
            2.0!
          </span>
        </h1>
      </header>

      {/* Game Info Header */}
      <div className="flex items-end justify-between px-4 py-3">
        {/* Left side: Team info + Question number */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: team.teamColor.hexCode }}
            />
            <span className="text-sm">{team.teamName}</span>
          </div>
          <span className="text-2xl font-bold">Question {currentQuestionNumber}</span>
        </div>

        {/* Right side: Timer */}
        <TimerDisplay seconds={timerSeconds} className="text-4xl" />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col px-4 py-6">
        {/* View A: Submissions not yet open */}
        {!timerRunning && !hasAnswer && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-base text-gray-600 text-center">
              Submissions are not yet open
            </p>
          </div>
        )}

        {/* View B: Answer input */}
        {timerRunning && (
          <div className="flex flex-col gap-3">
            <label className="text-base">Answer</label>
            <textarea
              value={draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value)}
              disabled={hasAnswer}
              rows={3}
              className="w-full p-3 border border-gray-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSubmitAnswer}
              disabled={!draftAnswer.trim() || hasAnswer}
              style={{ backgroundColor: team.teamColor.hexCode }}
              className="w-full py-3 text-white font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {hasAnswer ? "Answer Submitted" : "Submit Answer"}
            </button>
          </div>
        )}

        {/* View C: Submissions closed 
        Need to figure out how to untangle the bools here to get the messages I want when I want em
        Maybe just adding a frontend only timerHasOpened which is set to true when
        */}
        {!timerRunning && hasAnswer && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <p className="text-base text-gray-600 text-center">
              Submissions closed.
            </p>
            <p className="italic text-center">Your answer:</p>
            <p className="text-center">{submittedAnswerText ?? "You didn't submit anything :("}</p>
          </div>
        )}
      </div>

      {/* Footer buttons (shown when not in answer input mode) */}
      {!timerRunning && (
        <div className="p-4 flex gap-3">
          <Button
            variant="primary"
            onClick={() => handleStubButton("View Score Log")}
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
