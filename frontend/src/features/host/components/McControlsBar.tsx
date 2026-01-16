import type { McConfig, McOptionType } from "../../../types";
import { mcOptionTypeLabels } from "../../../types";

interface McControlsBarProps {
  config: McConfig;
  disabled: boolean;
  onConfigChange: (config: McConfig) => void;
}

export default function McControlsBar({
  config,
  disabled,
  onConfigChange,
}: McControlsBarProps) {
  const isFixedOptions =
    config.optionType === "yesNo" || config.optionType === "trueFalse";
  const showEditButton = config.optionType === "other";

  const handleOptionTypeChange = (optionType: McOptionType) => {
    let numOptions = config.numOptions;
    // Force 2 options for Yes/No and True/False
    if (optionType === "yesNo" || optionType === "trueFalse") {
      numOptions = 2;
    } else if (config.optionType === "yesNo" || config.optionType === "trueFalse") {
      // Switching from fixed to non-fixed, restore to default 4
      numOptions = 4;
    }
    onConfigChange({ ...config, optionType, numOptions });
  };

  const handleNumOptionsChange = (numOptions: number) => {
    // Clamp between 2 and 8
    const clamped = Math.max(2, Math.min(8, numOptions));
    onConfigChange({ ...config, numOptions: clamped });
  };

  return (
    <div className="flex justify-between gap-4 p-4 m-4 rounded-2xl bg-gray-100">
      {/* Option Type Dropdown */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600 whitespace-nowrap">
          Option type
        </label>
        <select
          value={config.optionType}
          onChange={(e) => handleOptionTypeChange(e.target.value as McOptionType)}
          disabled={disabled}
          className="px-3 py-1.5 border border-gray-300 rounded-xl text-sm bg-white disabled:bg-gray-200 disabled:cursor-not-allowed"
        >
          {Object.entries(mcOptionTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Edit Options Button (only for Other) */}
      {showEditButton && (
        <button
          disabled={true} // Always disabled for now
          className="text-gray-600 hover:text-gray-900 underline cursor-not-allowed"
          title="Custom options not yet implemented"
        >
          Edit Options
        </button>
      )}

      {/* Number of Options */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600 whitespace-nowrap">
          Number of options
        </label>
        <input
          type="number"
          value={config.numOptions}
          onChange={(e) => handleNumOptionsChange(parseInt(e.target.value) || 4)}
          disabled={disabled || isFixedOptions}
          min={2}
          max={8}
          className="w-16 px-2 py-1.5 border border-gray-300 rounded-xl text-sm text-center bg-white disabled:bg-gray-200 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}
