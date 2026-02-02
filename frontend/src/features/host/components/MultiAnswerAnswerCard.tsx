import { Plus, Minus, Zap } from "lucide-react";
import type { ScoreData } from "../../../types";
import { getScore } from "../../../types";

interface MultiAnswerAnswerCardProps {
  teamName: string;
  answers: string[];
  correct: boolean[];
  teamColor: string;
  score: ScoreData;
  bonusIncrement: number;
  onToggleCorrectness: (subAnswerIndex: number) => void;
  onScoreChange: (score: ScoreData) => void;
}

export default function MultiAnswerAnswerCard({
  teamName,
  answers,
  correct,
  teamColor,
  score,
  bonusIncrement,
  onToggleCorrectness,
  onScoreChange,
}: MultiAnswerAnswerCardProps) {
  const totalScore = getScore(score);

  const handleIncrement = () => {
    onScoreChange({
      ...score,
      bonusPoints: score.bonusPoints + bonusIncrement,
    });
  };

  const handleDecrement = () => {
    onScoreChange({
      ...score,
      bonusPoints: score.bonusPoints - bonusIncrement,
    });
  };

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-4xl border-2"
      style={{ borderColor: teamColor }}
    >
      {/* Score display and bonus controls */}
      <div className="flex items-center gap-2">
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

      {/* Team name and sub-answer pills */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <p className="font-bold">{teamName}</p>
          {score.speedBonusPoints > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded-full">
              <Zap className="w-3 h-3" />
              +{score.speedBonusPoints}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {answers.map((answer, i) => {
            const isEmpty = answer.trim() === "";
            const isCorrect = correct[i] ?? false;

            if (isEmpty) {
              // Empty pill - dashed border, not clickable
              return (
                <span
                  key={i}
                  className="px-3 py-1 rounded-full border-2 border-dashed border-gray-300 text-gray-400 text-sm italic"
                >
                  empty
                </span>
              );
            }

            return (
              <button
                key={i}
                onClick={() => onToggleCorrectness(i)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors cursor-pointer ${
                  isCorrect
                    ? "bg-green-600/60 hover:bg-green-700/60 text-white"
                    : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                }`}
              >
                {answer}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
