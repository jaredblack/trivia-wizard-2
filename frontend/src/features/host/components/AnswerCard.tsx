import { Check, X, Plus, Minus } from "lucide-react";
import { useState } from "react";
import type { ScoreData } from "../../../types";
import { getScore } from "../../../types";

interface AnswerCardProps {
  teamName: string;
  answerText: string;
  teamColor: string;
  initialScore: ScoreData;
  questionPoints: number; // Points awarded when marking correct
  bonusIncrement: number; // Points added/removed per +/- click
  onScoreChange?: (score: ScoreData) => void;
}

export default function AnswerCard({
  teamName,
  answerText,
  teamColor,
  initialScore,
  questionPoints,
  bonusIncrement,
  onScoreChange,
}: AnswerCardProps) {
  const [score, setScore] = useState<ScoreData>(initialScore);

  // Is marked correct if questionPoints > 0
  const isCorrect = score.questionPoints > 0;

  const updateScore = (newScore: ScoreData) => {
    setScore(newScore);
    onScoreChange?.(newScore);
  };

  const handleToggleCorrect = () => {
    const newScore: ScoreData = {
      ...score,
      questionPoints: isCorrect ? 0 : questionPoints,
    };
    updateScore(newScore);
  };

  const handleIncrement = () => {
    const newScore: ScoreData = {
      ...score,
      bonusPoints: score.bonusPoints + bonusIncrement,
    };
    updateScore(newScore);
  };

  const handleDecrement = () => {
    const newScore: ScoreData = {
      ...score,
      bonusPoints: score.bonusPoints - bonusIncrement,
    };
    updateScore(newScore);
  };

  const totalScore = getScore(score);

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-xl border-2"
      style={{ borderColor: teamColor }}
    >
      {/* Correct/incorrect toggle button */}
      <button
        onClick={handleToggleCorrect}
        className={`w-8 h-8 rounded border-2 flex items-center justify-center transition-colors ${
          isCorrect
            ? "bg-gray-800 border-gray-800 text-white"
            : "border-gray-300 hover:border-gray-400 text-gray-400"
        }`}
        aria-label={isCorrect ? "Mark incorrect" : "Mark correct"}
      >
        {isCorrect ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
      </button>

      {/* Score display and bonus controls */}
      <div className="flex items-center gap-1">
        <span className="text-3xl font-bold w-12 text-center">{totalScore}</span>
        <div className="flex flex-col">
          <button
            onClick={handleIncrement}
            className="p-0.5 hover:bg-gray-100 rounded"
            aria-label="Add bonus points"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={handleDecrement}
            className="p-0.5 hover:bg-gray-100 rounded"
            aria-label="Remove bonus points"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Team name and answer */}
      <div className="flex-1 min-w-0">
        <p className="font-bold truncate">{teamName}</p>
        <p className="text-gray-600 truncate">{answerText}</p>
      </div>
    </div>
  );
}
