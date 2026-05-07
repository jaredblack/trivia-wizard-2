import { useOutletContext, useNavigate, Link } from "react-router-dom";
import type { AuthOutletContext } from "../../ProtectedRoute";
import { useEffect, useState, useRef } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { startServer } from "../../aws";
import { isLocalMode, healthUrl } from "../../config";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import ProgressBar from "../../components/ui/ProgressBar";
import Header from "../../components/layout/Header";
import { useHostStore, subscribeToHostMessages } from "../../stores/useHostStore";
import { useWebSocket } from "../../hooks/useWebSocket";
import { saveHostRejoin } from "../../utils/rejoinStorage";
import type { HostClientMessage } from "../../types";
import { listEvents, type EventSummary } from "../../services/eventsApi";

export default function HostLanding() {
  const { signOut } = useOutletContext<AuthOutletContext>();
  const navigate = useNavigate();
  const gameCode = useHostStore((state) => state.gameCode);
  const { connectionState, connectAndSend } = useWebSocket();

  const [serverRunning, setServerRunning] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [serverStartFailed, setServerStartFailed] = useState(false);
  const [customGameCode, setCustomGameCode] = useState("");
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string>("");
  const hasNavigated = useRef(false);

  // Load the events list once the user is confirmed as a host (in local
  // mode this fires immediately).
  useEffect(() => {
    if (!isHost) return;
    let cancelled = false;
    listEvents()
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
        if (rows.length > 0) setSelectedUuid(rows[0].uuid);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load events:", e);
        setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isHost]);

  // Subscribe to host messages
  useEffect(() => {
    return subscribeToHostMessages();
  }, []);

  useEffect(() => {
    if (isLocalMode) {
      setIsHost(true);
      return;
    }

    const checkGroup = async () => {
      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        if (idToken) {
          const payload = JSON.parse(atob(idToken.split(".")[1]));
          const groups = payload["cognito:groups"];
          if (groups && groups.includes("Trivia-Hosts")) {
            setIsHost(true);
          }
        }
      } catch (error) {
        console.error("Error getting user session:", error);
      }
    };

    checkGroup();
  }, []);

  useEffect(() => {
    serverIsRunning().then((running) => {
      if (running) {
        setServerRunning(true);
      }
    });
  }, []);

  const serverIsRunning = async () => {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch (error) {
      console.log(`server not ready yet: ${error}`);
      return false;
    }
  };

  const pollServerStatus = () => {
    let succeeded = false;
    const interval = setInterval(async () => {
      if (await serverIsRunning()) {
        succeeded = true;
        setServerRunning(true);
        setIsStartingServer(false);
        clearInterval(interval);
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(interval);
      setIsStartingServer(false);
      if (!succeeded) {
        setServerStartFailed(true);
      }
    }, 120000);
  };

  const handleStartServer = async () => {
    setIsStartingServer(true);
    setServerStartFailed(false);
    try {
      await startServer();
      pollServerStatus();
    } catch (error) {
      console.error("Error starting server:", error);
      setIsStartingServer(false);
    }
  };

  const handleCustomGameCodeChange = (value: string) => {
    setCustomGameCode(value.toUpperCase());
  };

  // Navigate to game page when game is created (gameCode is set), and open
  // the projector window for the selected event.
  useEffect(() => {
    if (gameCode && !hasNavigated.current) {
      hasNavigated.current = true;
      saveHostRejoin({ gameCode });
      if (selectedUuid) {
        window.open(`/present/${selectedUuid}`, "_blank", "noopener");
      }
      navigate("/host/game");
    }
  }, [gameCode, navigate, selectedUuid]);

  const createGame = async (useCustomCode: boolean) => {
    setIsCreatingGame(true);
    try {
      const msg: HostClientMessage = {
        host: {
          type: "createGame",
          gameCode: useCustomCode ? customGameCode : undefined,
          uuid: selectedUuid || undefined,
        },
      };
      await connectAndSend(msg);
      // Success - message handlers will update store and effect will navigate
    } catch (error) {
      console.error("Error creating game:", error);
      setIsCreatingGame(false);
    }
  };


  return (
    <div className="min-h-screen flex flex-col">
      <Header onLogOut={signOut} />

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center gap-6">
        {/* Server starting state */}
        {isStartingServer && (
          <>
            <ProgressBar durationMs={120000} isComplete={serverRunning} />
            <p className="text-lg text-gray-600">Starting server...</p>
          </>
        )}

        {/* Server start failed state */}
        {!isStartingServer && !serverRunning && serverStartFailed && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500" />
              <span className="text-red-600">Server failed to start</span>
            </div>
            <p className="text-gray-600 text-center max-w-md">
              Retry first, then bug Jared to help troubleshoot.
            </p>
            <Button
              variant="primary"
              onClick={handleStartServer}
              disabled={!isHost || isLocalMode}
              className="px-12 py-4 text-lg"
            >
              Retry
            </Button>
          </>
        )}

        {/* Server off state */}
        {!isStartingServer && !serverRunning && !serverStartFailed && (
          <>
            <h2 className="text-5xl font-bold">Welcome!</h2>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-gray-400" />
              <span className="text-gray-600">Server inactive</span>
            </div>
            <Button
              variant="primary"
              onClick={handleStartServer}
              disabled={!isHost || isLocalMode}
              className="px-12 py-4 text-lg"
            >
              Start Server
            </Button>
          </>
        )}

        {/* Server running state */}
        {!isStartingServer && serverRunning && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-green-500" />
              <span className="text-lg">Server running!</span>
            </div>

            {connectionState === "error" ? (
              <div className="text-center">
                <p className="text-red-600 mb-4">
                  {isLocalMode
                    ? "Local server not running"
                    : "Connection error"}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => setIsCreatingGame(false)}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <EventPicker
                  events={events}
                  selectedUuid={selectedUuid}
                  onChange={setSelectedUuid}
                />
                <div className="flex items-center gap-2">
                  <Input
                    value={customGameCode}
                    onChange={handleCustomGameCodeChange}
                    autoCapitalize="characters"
                    placeholder="Game code"
                    className="w-32 text-center"
                  />
                  <Button
                    variant="primary"
                    onClick={() => createGame(true)}
                    disabled={
                      isCreatingGame || !customGameCode || !selectedUuid
                    }
                  >
                    Create Game
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => createGame(false)}
                  disabled={isCreatingGame || !selectedUuid}
                  className="flex flex-col items-center py-4"
                >
                  <span>Create Game</span>
                  <span className="text-sm text-gray-500">
                    with random game code
                  </span>
                </Button>
              </div>
            )}
          </>
        )}

      </main>

      {/* Footer */}
      <footer className="p-4">
        <a
          href="https://jarbla.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Jarbla Home
        </a>
      </footer>
    </div>
  );
}

interface EventPickerProps {
  events: EventSummary[] | null;
  selectedUuid: string;
  onChange: (uuid: string) => void;
}

function EventPicker({ events, selectedUuid, onChange }: EventPickerProps) {
  if (events === null) {
    return <p className="text-sm text-gray-500">Loading events…</p>;
  }
  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No events yet.{" "}
        <Link to="/host/events" className="underline">
          Create your first event
        </Link>
        .
      </p>
    );
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-gray-700">Event:</span>
      <select
        value={selectedUuid}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-400 rounded px-2 py-1 bg-white"
      >
        {events.map((e) => (
          <option key={e.uuid} value={e.uuid}>
            {e.subtitle ? `${e.title} — ${e.subtitle}` : e.title}
          </option>
        ))}
      </select>
      <Link to="/host/events" className="underline text-gray-600 text-xs">
        manage
      </Link>
    </label>
  );
}
