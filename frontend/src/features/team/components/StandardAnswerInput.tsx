import ColorButton from "../../../components/ui/ColorButton";

interface StandardAnswerInputProps {
  draftAnswer: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  teamColor: string;
}

export default function StandardAnswerInput({
  draftAnswer,
  onDraftChange,
  onSubmit,
  teamColor,
}: StandardAnswerInputProps) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-base">Answer</label>
      <textarea
        value={draftAnswer}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={3}
        className="w-full p-3 border border-gray-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
      />
      <ColorButton
        onClick={onSubmit}
        disabled={!draftAnswer.trim()}
        backgroundColor={teamColor}
        className="w-full py-3 rounded-lg"
      >
        Submit Answer
      </ColorButton>
    </div>
  );
}
