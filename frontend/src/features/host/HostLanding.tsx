import { useOutletContext, useNavigate } from "react-router-dom";
import type { AuthOutletContext } from "../../ProtectedRoute";
import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { startServer } from "../../aws";
import { isLocalMode, wsUrl, healthUrl } from "../../config";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import ProgressBar from "../../components/ui/ProgressBar";
import Header from "../../components/layout/Header";
import { useHostStore } from "../../stores/useHostStore";
import type { GameCreated } from "../../types";

async function buildWsUrl(): Promise<string> {
  if (isLocalMode) {
    return wsUrl;
  }
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error(
      "No access token available - user may not be authenticated"
    );
  }
  return `${wsUrl}?token=${encodeURIComponent(token)}`;
}

type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export default function HostLanding() {
  const { user, signOut } = useOutletContext<AuthOutletContext>();
  const navigate = useNavigate();
  const setGameData = useHostStore((state) => state.setGameData);

  const [serverRunning, setServerRunning] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [serverStartFailed, setServerStartFailed] = useState(false);
  const [customGameCode, setCustomGameCode] = useState("");
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");

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

  const createGame = async (_useCustomCode: boolean) => {
    setConnectionState("connecting");
    try {
      const url = await buildWsUrl();
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setConnectionState("connected");
        // TODO: support custom game codes when backend supports it
        ws.send(JSON.stringify({ host: "createGame" }));
      };

      ws.onmessage = (event) => {
        console.log("Message from server: ", event.data);
        try {
          const message = JSON.parse(event.data);
          if (message.host?.gameCreated) {
            const gameCreated = message.host.gameCreated as GameCreated;
            setGameData(gameCreated);
            navigate("/host/game");
          } else if (message.error) {
            console.error("Server error:", message.error);
          }
        } catch {
          console.log("Non-JSON message from server:", event.data);
        }
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected", event.code, event.reason);
        setConnectionState((prev) =>
          prev === "connected" ? "disconnected" : "error"
        );
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnectionState("error");
      };
    } catch (error) {
      console.error("Error creating game:", error);
      setConnectionState("error");
    }
  };

  // Extract first name or username
  const displayName = user?.username?.split("@")[0] || user?.username || "Host";

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
            <h2 className="text-5xl font-bold">Welcome, {displayName}</h2>
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
                  onClick={() => setConnectionState("idle")}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-2">
                  <Input
                    value={customGameCode}
                    onChange={setCustomGameCode}
                    placeholder="Game code"
                    className="w-32 text-center"
                  />
                  <Button
                    variant="primary"
                    onClick={() => createGame(true)}
                    disabled={
                      connectionState === "connecting" || !customGameCode
                    }
                  >
                    Create Game
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => createGame(false)}
                  disabled={connectionState === "connecting"}
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
