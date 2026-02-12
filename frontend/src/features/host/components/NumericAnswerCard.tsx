import { Plus, Minus, Zap } from "lucide-react";
import type { ScoreData } from "../../../types";
import { getScore } from "../../../types";

interface NumericAnswerCardProps {
  teamName: string;
  answerText: string;
  teamColor: string;
  score: ScoreData;
  bonusIncrement: number;
  onScoreChange: (score: ScoreData) => void;
}

export default function NumericAnswerCard({
  teamName,
  answerText,
  teamColor,
  score,
  bonusIncrement,
  onScoreChange,
}: NumericAnswerCardProps) {
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

      {/* Team name and answer */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-bold">{teamName}</p>
          {score.speedBonusPoints > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded-full">
              <Zap className="w-3 h-3" />
              +{score.speedBonusPoints}
            </span>
          )}
        </div>
        <p className="text-lg text-gray-700 mt-1">{answerText}</p>
      </div>
    </div>
  );
}
