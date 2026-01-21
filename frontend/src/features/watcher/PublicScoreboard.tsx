import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useWatcherStore } from "../../stores/useWatcherStore";
import { getScore } from "../../types";
import type { TeamData } from "../../types";

export default function PublicScoreboard() {
  const navigate = useNavigate();
  const { connectionState, send, connect, disconnect } = useWebSocket();
  const { gameCode, scoreboardData, error, setGameCode, setError, reset } =
    useWatcherStore();
  const [inputCode, setInputCode] = useState("");
  const [isWatching, setIsWatching] = useState(false);
  const prevConnectionState = useRef(connectionState);

  // Connect WebSocket on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
      reset();
    };
  }, [connect, disconnect, reset]);

  // Handle reconnection: re-send watchGame message
  useEffect(() => {
    if (
      prevConnectionState.current === "reconnecting" &&
      connectionState === "connected" &&
      isWatching &&
      gameCode
    ) {
      send({
        watcher: {
          watchGame: { gameCode },
        },
      });
    }
    prevConnectionState.current = connectionState;
  }, [connectionState, isWatching, gameCode, send]);

  // When scoreboardData arrives, we're successfully watching
  useEffect(() => {
    if (scoreboardData) {
      setIsWatching(true);
    }
  }, [scoreboardData]);

  const handleWatch = useCallback(() => {
    const code = inputCode.trim().toUpperCase();
    if (!code) return;

    setError(null);
    setGameCode(code);
    send({
      watcher: {
        watchGame: { gameCode: code },
      },
    });
  }, [inputCode, send, setGameCode, setError]);

  const handleBack = useCallback(() => {
    if (isWatching) {
      setIsWatching(false);
      reset();
      setInputCode("");
    } else {
      disconnect();
      reset();
      navigate("/");
    }
  }, [isWatching, disconnect, reset, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleWatch();
      }
    },
    [handleWatch]
  );

  // Sort teams by score descending
  const sortedTeams = scoreboardData
    ? [...scoreboardData.teams].sort(
        (a, b) => getScore(b.score) - getScore(a.score)
      )
    : [];

  // Calculate placement for each team, handling ties
  const getPlacement = (index: number, teams: TeamData[]): string => {
    if (index === 0) return "1.";
    const currentScore = getScore(teams[index].score);
    const prevScore = getScore(teams[index - 1].score);
    if (currentScore === prevScore) return "";
    return `${index + 1}.`;
  };

  // Show scoreboard if we have data
  if (isWatching && scoreboardData) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <button
            onClick={handleBack}
            className="text-gray-600 hover:text-gray-900"
          >
            &larr; Back
          </button>
          <h1 className="text-lg font-semibold">
            Scoreboard: {gameCode}
          </h1>
          <div className="w-12" /> {/* Spacer for centering */}
        </header>

        {/* Scoreboard */}
        <div className="flex-1 px-4 py-6">
          {sortedTeams.length === 0 ? (
            <p className="text-center text-gray-500">No teams yet</p>
          ) : (
            <div className="flex flex-col space-y-3 items-center">
              {sortedTeams.map((team, index) => {
                const placement = getPlacement(index, sortedTeams);
                const score = getScore(team.score);
                return (
                  <div
                    key={team.teamName}
                    className="flex items-center justify-between p-4 rounded-xl border border-gray-200 w-lg"
                    style={{
                      borderLeftWidth: "4px",
                      borderLeftColor: team.teamColor.hexCode,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-2xl font-bold text-gray-500">
                        {placement}
                      </span>
                      <span className="font-medium text-2xl">{team.teamName}</span>
                    </div>
                    <span className="text-5xl font-bold">{score}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show game code entry form
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <button
          onClick={handleBack}
          className="text-gray-600 hover:text-gray-900"
        >
          &larr; Back
        </button>
        <h1 className="text-lg font-semibold">Watch Scoreboard</h1>
        <div className="w-12" /> {/* Spacer for centering */}
      </header>

      {connectionState === "connecting" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500">Connecting...</p>
        </div>
      )}

      {connectionState === "error" && (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-red-500 text-center">
            Failed to connect. Please try again.
          </p>
        </div>
      )}

      {connectionState === "connected" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-sm space-y-4">
            <div>
              <label
                htmlFor="gameCode"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Game Code
              </label>
              <input
                id="gameCode"
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                onKeyDown={handleKeyDown}
                className="w-full px-4 py-3 text-center text-2xl tracking-widest uppercase border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            </div>

            {error && <p className="text-red-500 text-sm text-center">{error}</p>}

            <button
              onClick={handleWatch}
              disabled={!inputCode.trim()}
              className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Watch Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
