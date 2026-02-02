import { useRef } from "react";
import ColorButton from "../../../components/ui/ColorButton";

interface MultiAnswerInputProps {
  numAnswers: number;
  draftAnswers: string[];
  onDraftChange: (answers: string[]) => void;
  onSubmit: () => void;
  teamColor: string;
}

export default function MultiAnswerInput({
  numAnswers,
  draftAnswers,
  onDraftChange,
  onSubmit,
  teamColor,
}: MultiAnswerInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, value: string) => {
    const newAnswers = [...draftAnswers];
    newAnswers[index] = value;
    onDraftChange(newAnswers);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Move to next input, or submit if on last one
      if (index < numAnswers - 1) {
        inputRefs.current[index + 1]?.focus();
      } else {
        onSubmit();
      }
    }
  };

  const allEmpty = draftAnswers.every((a) => !a.trim());

  return (
    <div className="flex flex-col gap-3">
      <label className="text-base">Answers</label>
      {Array.from({ length: numAnswers }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-sm text-gray-500 w-6 text-right">{i + 1}.</span>
          <input
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            value={draftAnswers[i] ?? ""}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            enterKeyHint={i < numAnswers - 1 ? "next" : "done"}
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            placeholder={`Answer ${i + 1}`}
            autoComplete="off"
          />
        </div>
      ))}
      <ColorButton
        onClick={onSubmit}
        disabled={allEmpty}
        backgroundColor={teamColor}
        className="w-full py-3 rounded-lg"
      >
        Submit Answers
      </ColorButton>
    </div>
  );
}
