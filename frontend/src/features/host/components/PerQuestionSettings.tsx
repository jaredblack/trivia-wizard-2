import { Settings, Zap } from "lucide-react";
import AutoSubmitNumericInput from "./AutoSubmitNumericInput";

interface PerQuestionSettings {
  questionPoints: number;
  bonusIncrement: number;
  timerLength: number;
  speedBonusEnabled: boolean;
  disabled?: boolean;
  onQuestionPointsChange?: (value: number) => void;
  onBonusIncrementChange?: (value: number) => void;
  onTimerLengthChange?: (value: number) => void;
  onSpeedBonusEnabledChange?: (enabled: boolean) => void;
  onOpenSettings?: () => void;
}

export default function PerQuestionSettings({
  questionPoints,
  bonusIncrement,
  timerLength,
  speedBonusEnabled,
  disabled,
  onQuestionPointsChange,
  onBonusIncrementChange,
  onTimerLengthChange,
  onSpeedBonusEnabledChange,
  onOpenSettings,
}: PerQuestionSettings) {
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

        {/* Speed Bonus Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSpeedBonusEnabledChange?.(!speedBonusEnabled)}
            disabled={disabled}
            className={`flex items-center gap-1 px-3 py-1 rounded-xl border transition-colors ${
              speedBonusEnabled
                ? "bg-yellow-100 border-yellow-400 text-yellow-700"
                : "bg-gray-100 border-gray-300 text-gray-500"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-80 cursor-pointer"}`}
            title={speedBonusEnabled ? "Speed bonus enabled" : "Speed bonus disabled"}
          >
            <Zap className="w-4 h-4" />
            <span className="text-sm">Speed</span>
          </button>
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
