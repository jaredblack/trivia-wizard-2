import { X } from "lucide-react";
import { questionKindLabels } from "../../../types";
import type { GameSettings, QuestionKind } from "../../../types";
import AutoSubmitNumericInput from "./AutoSubmitNumericInput";

interface SettingsModalProps {
  settings: GameSettings;
  onClose: () => void;
  onSettingsChange: (settings: GameSettings) => void;
}

export default function SettingsModal({
  settings,
  onClose,
  onSettingsChange,
}: SettingsModalProps) {
  const handleChange = <K extends keyof GameSettings>(
    key: K,
    value: GameSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-96 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Game Settings</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Settings fields */}
        <div className="space-y-4">
          {/* Default Timer Duration */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">
              Default Timer Duration (seconds)
            </label>
            <AutoSubmitNumericInput
              value={settings.defaultTimerDuration}
              onSubmit={(value) => handleChange("defaultTimerDuration", value)}
              min={1}
            />
          </div>

          {/* Default Question Points */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">
              Default Question Points
            </label>
            <AutoSubmitNumericInput
              value={settings.defaultQuestionPoints}
              onSubmit={(value) => handleChange("defaultQuestionPoints", value)}
              min={0}
            />
          </div>

          {/* Default Bonus Increment */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">
              Default Bonus Increment
            </label>
            <AutoSubmitNumericInput
              value={settings.defaultBonusIncrement}
              onSubmit={(value) => handleChange("defaultBonusIncrement", value)}
              min={0}
            />
          </div>

          {/* Default Question Type */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">
              Default Question Type
            </label>
            <select
              value={settings.defaultQuestionType}
              onChange={(e) =>
                handleChange("defaultQuestionType", e.target.value as QuestionKind)
              }
              className="border border-gray-300 bg-white rounded-xl px-2 py-1 hover:bg-gray-50 cursor-pointer"
            >
              <option value="standard">{questionKindLabels.standard}</option>
              <option value="multiAnswer">{questionKindLabels.multiAnswer}</option>
              <option value="multipleChoice">{questionKindLabels.multipleChoice}</option>
            </select>
          </div>

          {/* Speed Bonus Section */}
          <div className="border-t border-gray-200 pt-4 mt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Speed Bonus</h3>

            {/* Speed Bonus Enabled Toggle */}
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-gray-600">
                Enable Speed Bonus
              </label>
              <button
                onClick={() => handleChange("speedBonusEnabled", !settings.speedBonusEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.speedBonusEnabled ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.speedBonusEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Teams Eligible */}
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-gray-600">
                Teams Eligible
              </label>
              <AutoSubmitNumericInput
                value={settings.speedBonusNumTeams}
                onSubmit={(value) => handleChange("speedBonusNumTeams", value)}
                disabled={!settings.speedBonusEnabled}
                min={1}
                max={10}
              />
            </div>

            {/* First Place Points */}
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm text-gray-600">
                First Place Points
              </label>
              <AutoSubmitNumericInput
                value={settings.speedBonusFirstPlacePoints}
                onSubmit={(value) => handleChange("speedBonusFirstPlacePoints", value)}
                disabled={!settings.speedBonusEnabled}
                min={0}
              />
            </div>

            {/* Bonus Distribution Preview */}
            {settings.speedBonusEnabled && (
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
                Distribution: {Array.from({ length: settings.speedBonusNumTeams }, (_, i) => {
                  const remaining = settings.speedBonusNumTeams - i;
                  const bonus = Math.floor(
                    (settings.speedBonusFirstPlacePoints * remaining) / settings.speedBonusNumTeams
                  );
                  return `${i + 1}${["st", "nd", "rd"][i] || "th"}: ${bonus}`;
                }).join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
