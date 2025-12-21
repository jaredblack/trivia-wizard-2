import { useState } from "react";
import type { TeamData } from "../../../types";
import { getScore } from "../../../types";

interface ScoreboardProps {
  gameCode: string;
  teams: TeamData[];
}

export default function Scoreboard({ gameCode, teams }: ScoreboardProps) {
  const [allowTeamsToSee, setAllowTeamsToSee] = useState(true);

  // Sort teams by total score (descending)
  const sortedTeams = [...teams].sort(
    (a, b) => getScore(b.score) - getScore(a.score)
  );

  // Count connected teams
  const connectedCount = teams.filter((t) => t.connected).length;
  const totalCount = teams.length;

  return (
    <div className="flex flex-col h-full p-4">
      {/* Game code and connection status */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <span className="text-gray-600">Game Code: </span>
          <span className="text-2xl font-bold">{gameCode}</span>
        </div>
        <span className="text-sm text-gray-500">
          {connectedCount}/{totalCount} teams connected
        </span>
      </div>

      {/* Allow teams to see scoreboard checkbox */}
      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={allowTeamsToSee}
          onChange={(e) => setAllowTeamsToSee(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300" 
        />
        <span className="text-sm">Allow teams to see scoreboard</span>
      </label>

      {/* Team scores list */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {sortedTeams.map((team) => (
          <div key={team.teamName} className="flex items-center gap-3">
            {/* Score */}
            <span className="text-4xl font-bold w-24 text-right">
              {getScore(team.score)}
            </span>

            {/* Team color dot */}
            <div
              className="w-9 h-9 rounded-full flex-shrink-0"
              style={{ backgroundColor: team.teamColor.hexCode }}
            />

            {/* Team info */}
            <div className="flex-1 min-w-0">
              <p className="font-bold">{team.teamName}</p>
              <p className="text-sm text-gray-500 truncate">
                {team.teamMembers.join(", ")}
              </p>
            </div>

            {/* Connection indicator */}
            <div
              className={`w-3 h-3 rounded-full flex-shrink-0 ${
                team.connected ? "bg-green-500" : "bg-red-500"
              }`}
              title={team.connected ? "Connected" : "Disconnected"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
