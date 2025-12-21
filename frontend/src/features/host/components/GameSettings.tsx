import { Settings } from "lucide-react";

interface GameSettingsProps {
  questionPoints: number;
  bonusIncrement: number;
  timerLength: number;
  onQuestionPointsChange?: (value: number) => void;
  onBonusIncrementChange?: (value: number) => void;
  onTimerLengthChange?: (value: number) => void;
  onOpenSettings?: () => void;
}

export default function GameSettings({
  questionPoints,
  bonusIncrement,
  timerLength,
  onQuestionPointsChange,
  onBonusIncrementChange,
  onTimerLengthChange,
  onOpenSettings,
}: GameSettingsProps) {
  return (
    <footer className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white">
      <div className="flex items-center gap-8">
        {/* Question Points */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Question Points</label>
          <input
            type="number"
            value={questionPoints}
            onChange={(e) => onQuestionPointsChange?.(Number(e.target.value))}
            className="w-16 px-2 py-1 border border-gray-300 rounded-xl text-center"
          />
        </div>

        {/* Bonus Increment */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Bonus Increment</label>
          <input
            type="number"
            value={bonusIncrement}
            onChange={(e) => onBonusIncrementChange?.(Number(e.target.value))}
            className="w-16 px-2 py-1 border border-gray-300 rounded-xl text-center"
          />
        </div>

        {/* Timer Length */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Timer Length</label>
          <input
            type="number"
            value={timerLength}
            onChange={(e) => onTimerLengthChange?.(Number(e.target.value))}
            className="w-16 px-2 py-1 border border-gray-300 rounded-xl text-center"
          />
        </div>
      </div>

      {/* Settings gear icon */}
      <button
        onClick={onOpenSettings}
        className="p-2 hover:bg-gray-100 rounded-full pointer-cursor"
        aria-label="Open settings"
      >
        <Settings className="w-6 h-6 text-gray-600" />
      </button>
    </footer>
  );
}
