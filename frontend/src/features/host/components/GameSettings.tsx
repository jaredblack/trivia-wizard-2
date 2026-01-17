import { Settings } from "lucide-react";
import AutoSubmitNumericInput from "./AutoSubmitNumericInput";

interface GameSettingsProps {
  questionPoints: number;
  bonusIncrement: number;
  timerLength: number;
  disabled?: boolean;
  onQuestionPointsChange?: (value: number) => void;
  onBonusIncrementChange?: (value: number) => void;
  onTimerLengthChange?: (value: number) => void;
  onOpenSettings?: () => void;
}

export default function GameSettings({
  questionPoints,
  bonusIncrement,
  timerLength,
  disabled,
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
          <AutoSubmitNumericInput
            value={questionPoints}
            onSubmit={onQuestionPointsChange}
            disabled={disabled}
          />
        </div>

        {/* Bonus Increment */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Bonus Increment</label>
          <AutoSubmitNumericInput
            value={bonusIncrement}
            onSubmit={onBonusIncrementChange}
            disabled={disabled}
          />
        </div>

        {/* Timer Length */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Timer Length</label>
          <AutoSubmitNumericInput
            value={timerLength}
            onSubmit={onTimerLengthChange}
            disabled={disabled}
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
