import { Check, X, Plus, Minus } from "lucide-react";
import type { ScoreData } from "../../../types";
import { getScore } from "../../../types";

interface AnswerCardProps {
  teamName: string;
  answerText: string;
  teamColor: string;
  score: ScoreData;
  questionPoints: number; // Points awarded when marking correct
  bonusIncrement: number; // Points added/removed per +/- click
  onScoreChange: (score: ScoreData) => void;
}

export default function AnswerCard({
  teamName,
  answerText,
  teamColor,
  score,
  questionPoints,
  bonusIncrement,
  onScoreChange,
}: AnswerCardProps) {
  // Is marked correct if questionPoints > 0
  const isCorrect = score.questionPoints > 0;

  const handleToggleCorrect = () => {
    const newScore: ScoreData = {
      ...score,
      questionPoints: isCorrect ? 0 : questionPoints,
    };
    onScoreChange(newScore);
  };

  const handleIncrement = () => {
    const newScore: ScoreData = {
      ...score,
      bonusPoints: score.bonusPoints + bonusIncrement,
    };
    onScoreChange(newScore);
  };

  const handleDecrement = () => {
    const newScore: ScoreData = {
      ...score,
      bonusPoints: score.bonusPoints - bonusIncrement,
    };
    onScoreChange(newScore);
  };

  const totalScore = getScore(score);

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-4xl border-2"
      style={{ borderColor: teamColor }}
    >
      {/* Score display and bonus controls */}
      <div className="flex items-center gap-2">
        {/* Correct/incorrect toggle button */}
        <button
          onClick={handleToggleCorrect}
          className={`w-10 h-10 rounded-4xl border-2 flex items-center justify-center transition-colors cursor-pointer ${
            isCorrect
              ? "bg-green-600/60 hover:bg-green-700/60 text-white"
              : "border-red-300 hover:border-red-400 text-gray-400"
          }`}
          aria-label={isCorrect ? "Mark incorrect" : "Mark correct"}
        >
          {isCorrect ? (
            <Check className="w-5 h-5" />
          ) : (
            <X className="w-5 h-5 text-red-300 hover:text-red-400" />
          )}
        </button>
        <span className="text-3xl font-bold w-12 text-center">
          {totalScore}
        </span>
        <div className="flex flex-col bg-gray-200 rounded-3xl">
          <button
            onClick={handleIncrement}
            className="p-1 hover:bg-gray-100 rounded-3xl cursor-pointer"
            aria-label="Add bonus points"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={handleDecrement}
            className="p-1 hover:bg-gray-100 rounded-3xl cursor-pointer"
            aria-label="Remove bonus points"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Team name and answer */}
      <div className="flex-1 min-w-0">
        <p className="font-bold">{teamName}</p>
        <p className="text-gray-600">{answerText}</p>
      </div>
    </div>
  );
}
