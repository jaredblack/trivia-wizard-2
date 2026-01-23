import { useState, useRef, useEffect } from "react";
import type { TeamData, ScoreData } from "../../../types";
import { getScore } from "../../../types";

interface ScoreboardProps {
  gameCode: string;
  teams: TeamData[];
  onOverrideScore: (teamName: string, overridePoints: number) => void;
}

function parseScoreExpression(input: string): number | null {
  // Only allow numbers, spaces, + and -
  if (!/^[\d\s+-]+$/.test(input.trim())) {
    return null;
  }

  try {
    // Split by + and - while keeping the operators
    const tokens = input.trim().split(/(?=[+-])|(?<=[+-])/);
    let result = 0;
    let currentOp = "+";

    for (const token of tokens) {
      const trimmed = token.trim();
      if (trimmed === "") continue;
      if (trimmed === "+") {
        currentOp = "+";
      } else if (trimmed === "-") {
        currentOp = "-";
      } else {
        const num = parseInt(trimmed, 10);
        if (isNaN(num)) return null;
        result = currentOp === "+" ? result + num : result - num;
      }
    }
    return result;
  } catch {
    return null;
  }
}

function formatScoreBreakdown(score: ScoreData): string {
  return `Questions: ${score.questionPoints}, Bonus: ${score.bonusPoints}, Speed: ${score.speedBonusPoints}, Override: ${score.overridePoints}`;
}

interface EditableScoreProps {
  score: ScoreData;
  isHovered: boolean;
  onScoreChange: (newOverridePoints: number) => void;
}

function EditableScore({ score, isHovered, onScoreChange }: EditableScoreProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const currentScore = getScore(score);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    if (!isEditing) return;
    const parsed = parseScoreExpression(inputValue);
    if (parsed !== null) {
      // Calculate new override: newOverride = desiredTotal - questionPoints - bonusPoints - speedBonusPoints
      const newOverride = parsed - score.questionPoints - score.bonusPoints - score.speedBonusPoints;
      onScoreChange(newOverride);
    }
    setIsEditing(false);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setInputValue("");
    }
  };

  const handleClick = () => {
    if (isHovered && !isEditing) {
      setInputValue(String(currentScore));
      setIsEditing(true);
    }
  };

  if (isHovered || isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={isEditing ? inputValue : String(currentScore)}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        readOnly={!isEditing}
        className={`text-4xl font-bold w-24 text-right bg-transparent border-b-2 ${
          isEditing ? "border-blue-500 outline-none" : "border-gray-300 cursor-pointer"
        }`}
      />
    );
  }

  return (
    <span className="text-4xl font-bold w-24 text-right">
      {currentScore}
    </span>
  );
}

export default function Scoreboard({ gameCode, teams, onOverrideScore }: ScoreboardProps) {
  const [hoveredTeam, setHoveredTeam] = useState<string | null>(null);

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

      {/* Team scores list */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {sortedTeams.map((team) => {
          const isHovered = hoveredTeam === team.teamName;
          return (
            <div
              key={team.teamName}
              className="flex items-center gap-3"
              onMouseEnter={() => setHoveredTeam(team.teamName)}
              onMouseLeave={() => setHoveredTeam(null)}
            >
              {/* Score */}
              <EditableScore
                score={team.score}
                isHovered={isHovered}
                onScoreChange={(newOverride) => onOverrideScore(team.teamName, newOverride)}
              />

              {/* Team color dot */}
              <div
                className="w-9 h-9 rounded-full flex-shrink-0"
                style={{ backgroundColor: team.teamColor.hexCode }}
              />

              {/* Team info */}
              <div className="flex-1 min-w-0">
                <p className="font-bold">{team.teamName}</p>
                <p className="text-sm text-gray-500">
                  {isHovered
                    ? formatScoreBreakdown(team.score)
                    : team.teamMembers.join(", ")}
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
          );
        })}
      </div>
    </div>
  );
}
