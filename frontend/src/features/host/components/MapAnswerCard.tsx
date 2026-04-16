import { Plus, Minus, Zap } from "lucide-react";
import type { ScoreData } from "../../../types";
import { getScore } from "../../../types";

interface MapAnswerCardProps {
  teamName: string;
  lat: number;
  lng: number;
  correctLocation: [number, number] | null;
  teamColor: string;
  score: ScoreData;
  bonusIncrement: number;
  onScoreChange: (score: ScoreData) => void;
}

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  if (km < 100) {
    return `${km.toFixed(1)} km`;
  }
  return `${Math.round(km)} km`;
}

export default function MapAnswerCard({
  teamName,
  lat,
  lng,
  correctLocation,
  teamColor,
  score,
  bonusIncrement,
  onScoreChange,
}: MapAnswerCardProps) {
  const totalScore = getScore(score);

  const distance =
    correctLocation != null
      ? haversineDistanceKm(lat, lng, correctLocation[0], correctLocation[1])
      : null;

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
        <p className="text-gray-600">
          {lat.toFixed(4)}, {lng.toFixed(4)}
        </p>
        {distance != null && (
          <p className="text-sm text-gray-500">
            {formatDistance(distance)} away
          </p>
        )}
      </div>
    </div>
  );
}
