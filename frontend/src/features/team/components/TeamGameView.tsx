import { useTeamStore } from "../../../stores/useTeamStore";

export default function TeamGameView() {
  const { teamGameState } = useTeamStore();

  if (!teamGameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const { team } = teamGameState;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <div
        className="w-24 h-24 rounded-full"
        style={{ backgroundColor: team.teamColor.hexCode }}
      />
      <h1 className="text-3xl font-bold text-center">{team.teamName}</h1>
      <p className="text-xl text-gray-600">You're in the game!</p>
      <p className="text-gray-500 text-center">
        Waiting for the host to start...
      </p>
    </div>
  );
}
