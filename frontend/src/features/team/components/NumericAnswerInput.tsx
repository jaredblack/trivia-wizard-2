import ColorButton from "../../../components/ui/ColorButton";

interface NumericAnswerInputProps {
  draftAnswer: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  teamColor: string;
}

export default function NumericAnswerInput({
  draftAnswer,
  onDraftChange,
  onSubmit,
  teamColor,
}: NumericAnswerInputProps) {
  const isValid = draftAnswer.trim() !== "" && !isNaN(Number(draftAnswer.trim()));

  return (
    <div className="flex flex-col gap-3">
      <label className="text-base">Numeric Answer</label>
      <input
        type="text"
        inputMode="decimal"
        value={draftAnswer}
        onChange={(e) => {
          const val = e.target.value;
          // Allow digits, decimal point, minus sign (at start only), and empty
          if (val === "" || val === "-" || /^-?\d*\.?\d*$/.test(val)) {
            onDraftChange(val);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && isValid) {
            onSubmit();
          }
        }}
        className="w-full p-3 border border-gray-300 rounded-lg text-center text-2xl focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
        placeholder="Enter a number"
      />
      <ColorButton
        onClick={onSubmit}
        disabled={!isValid}
        backgroundColor={teamColor}
        className="w-full py-3 rounded-lg"
      >
        Submit Answer
      </ColorButton>
    </div>
  );
}
