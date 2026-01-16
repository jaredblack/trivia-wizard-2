import ColorButton from "../../../components/ui/ColorButton";

interface MultipleChoiceAnswerInputProps {
  options: string[];
  selectedOption: string | null;
  onSelectOption: (option: string) => void;
  onSubmit: () => void;
  teamColor: string;
}

export default function MultipleChoiceAnswerInput({
  options,
  selectedOption,
  onSelectOption,
  onSubmit,
  teamColor,
}: MultipleChoiceAnswerInputProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Options grid - 2 columns */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = selectedOption === option;
          return (
            <button
              key={option}
              onClick={() => onSelectOption(option)}
              className={`
                h-36 px-4 text-xl font-medium rounded-lg border-2 transition-colors
                ${
                  isSelected
                    ? "text-white border-transparent"
                    : "bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200"
                }
              `}
              style={isSelected ? { backgroundColor: teamColor } : undefined}
            >
              {option}
            </button>
          );
        })}
      </div>

      {/* Submit button */}
      <ColorButton
        onClick={onSubmit}
        disabled={!selectedOption}
        backgroundColor={teamColor}
        className="w-full py-3 rounded-lg"
      >
        Submit Answer
      </ColorButton>
    </div>
  );
}
