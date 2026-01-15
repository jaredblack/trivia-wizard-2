import { useRef } from "react";
import { useTeamStore } from "../../../stores/useTeamStore";
import { useWebSocket } from "../../../hooks/useWebSocket";
import Input from "../../../components/ui/Input";
import Button from "../../../components/ui/Button";

export default function JoinStep() {
  const {
    gameCode,
    teamName,
    isValidating,
    setGameCode,
    setTeamName,
    setIsValidating,
  } = useTeamStore();
  const { send, connect } = useWebSocket();
  const teamNameRef = useRef<HTMLInputElement>(null);

  const canProceed =
    gameCode.trim() !== "" && teamName.trim() !== "" && !isValidating;

  const handleNext = async () => {
    if (!canProceed) return;

    setIsValidating(true);
    await connect();
    send({
      team: {
        validateJoin: {
          gameCode: gameCode.trim(),
          teamName: teamName.trim(),
        },
      },
    });
  };

  const handleGameCodeChange = (value: string) => {
    setGameCode(value.toUpperCase());
  };

  const focusTeamName = () => {
    teamNameRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Game code</label>
        <Input
          value={gameCode}
          onChange={handleGameCodeChange}
          placeholder="Enter game code"
          className="w-full"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          onEnter={focusTeamName}
          disabled={isValidating}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">Team name</label>
        <Input
          ref={teamNameRef}
          value={teamName}
          onChange={setTeamName}
          placeholder="Enter team name"
          className="w-full"
          enterKeyHint="done"
          onEnter={handleNext}
          disabled={isValidating}
        />
      </div>

      <Button
        onClick={handleNext}
        disabled={!canProceed}
        className="w-full mt-4"
      >
        {isValidating ? "Validating..." : "Next"}
      </Button>
    </div>
  );
}
