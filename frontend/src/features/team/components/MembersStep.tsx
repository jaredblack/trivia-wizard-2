import { useRef, useEffect } from "react";
import { useTeamStore } from "../../../stores/useTeamStore";
import Input from "../../../components/ui/Input";
import Button from "../../../components/ui/Button";

export default function MembersStep() {
  const { teamName, teamMembers, addMember, setMemberName, setStep } =
    useTeamStore();
  const lastInputRef = useRef<HTMLInputElement>(null);
  const prevLengthRef = useRef(teamMembers.length);

  const filledMembers = teamMembers.filter((m) => m.trim() !== "");
  const canProceed = filledMembers.length > 0;

  // Focus the new input when a member is added
  useEffect(() => {
    if (teamMembers.length > prevLengthRef.current) {
      lastInputRef.current?.focus();
    }
    prevLengthRef.current = teamMembers.length;
  }, [teamMembers.length]);

  const handleNext = () => {
    if (canProceed) {
      setStep("color");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h2 className="text-xl font-bold">{teamName}</h2>
        <p className="text-gray-600">Who's on your team?</p>
      </div>

      <div className="flex flex-col gap-3">
        {teamMembers.map((member, index) => (
          <div key={index} className="flex items-center gap-3">
            <span className="text-gray-400 w-6 text-right">{index + 1}.</span>
            <Input
              ref={index === teamMembers.length - 1 ? lastInputRef : undefined}
              value={member}
              onChange={(value) => setMemberName(index, value)}
              placeholder="Team member name"
              className="flex-1"
            />
          </div>
        ))}
      </div>

      <button
        onClick={addMember}
        className="w-full py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
      >
        +
      </button>

      <Button onClick={handleNext} disabled={!canProceed} className="w-full">
        Next
      </Button>
    </div>
  );
}
