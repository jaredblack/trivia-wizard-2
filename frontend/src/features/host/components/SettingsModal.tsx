import { X } from "lucide-react";
import { questionKindLabels } from "../../../types";
import type { GameSettings, QuestionKind } from "../../../types";

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
            <input
              type="number"
              value={settings.defaultTimerDuration}
              onChange={(e) =>
                handleChange("defaultTimerDuration", Number(e.target.value))
              }
              className="w-20 px-2 py-1 border border-gray-300 rounded-xl text-center"
            />
          </div>

          {/* Default Question Points */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">
              Default Question Points
            </label>
            <input
              type="number"
              value={settings.defaultQuestionPoints}
              onChange={(e) =>
                handleChange("defaultQuestionPoints", Number(e.target.value))
              }
              className="w-20 px-2 py-1 border border-gray-300 rounded-xl text-center"
            />
          </div>

          {/* Default Bonus Increment */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">
              Default Bonus Increment
            </label>
            <input
              type="number"
              value={settings.defaultBonusIncrement}
              onChange={(e) =>
                handleChange("defaultBonusIncrement", Number(e.target.value))
              }
              className="w-20 px-2 py-1 border border-gray-300 rounded-xl text-center"
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
        </div>
      </div>
    </div>
  );
}
