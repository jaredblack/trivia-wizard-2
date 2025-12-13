import { useOutletContext } from "react-router-dom";
import type { AuthOutletContext } from "./ProtectedRoute";
import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { getCredentials } from "./aws";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { isLocalMode, wsUrl } from "./config";

async function buildWsUrl(): Promise<string> {
  if (isLocalMode) {
    return wsUrl;
  }
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error("No access token available - user may not be authenticated");
  }
  return `${wsUrl}?token=${encodeURIComponent(token)}`;
}

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

export default function HostLanding() {
  const { user, signOut } = useOutletContext<AuthOutletContext>();
  const [serverRunning, setServerRunning] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");

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
        const response = await fetch("https://ws.trivia.jarbla.com/health", { signal: AbortSignal.timeout(2000) });
        return response.ok;
      } catch (error) {
        console.log(`server not ready yet: ${error}`);
        return false;
      }
  }

  const pollServerStatus = () => {
    console.log("trying to poll server status");
    const interval = setInterval(async () => {
      if (await serverIsRunning()) {
          setServerRunning(true);
          setIsLoading(false);
          clearInterval(interval);
      }
    }, 5000); // Poll every 5 seconds

    setTimeout(() => {
      clearInterval(interval);
      setIsLoading(false);
    }, 120000);
  };

  const startServer = async () => {
    setIsLoading(true);
    try {
      const credentials = await getCredentials();
      const ecsClient = new ECSClient({ credentials, region: "us-east-1" });
      const command = new UpdateServiceCommand({
        cluster: "TriviaWizardServer",
        service: "trivia-wizard-fargate-service",
        desiredCount: 1,
    
      });
      await ecsClient.send(command);
      pollServerStatus();
    } catch (error) {
      console.error("Error starting server:", error);
      setIsLoading(false);
    }
  };

  const startGame = async () => {
    setConnectionState("connecting");
    try {
      const url = await buildWsUrl();
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log("WebSocket connected");
        setConnectionState("connected");
        ws.send(JSON.stringify({ host: "createGame" }));
      };

      ws.onmessage = (event) => {
        console.log("Message from server: ", event.data);
        try {
          const message = JSON.parse(event.data);
          if (message.host.gameCreated && message.host.gameCreated.gameCode) {
            console.log("game code " + message.host.gameCreated.gameCode)
            setGameCode(message.host.gameCreated.gameCode);
          } else if (message.Error) {
            console.error("Server error:", message.Error);
          }
        } catch {
          console.log("Non-JSON message from server:", event.data);
        }
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected", event.code, event.reason);
        if (event.reason) {
          console.error("WebSocket close reason:", event.reason);
        }
        setConnectionState((prev) => prev === "connected" ? "disconnected" : "error");
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnectionState("error");
      };
    } catch (error) {
      console.error("Error starting game:", error);
      setConnectionState("error");
    }
  };
      
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="flex justify-between items-center p-4 bg-gray-100">
        <h1 className="text-xl font-bold">Hello, {user?.username}</h1>
        <button
          onClick={signOut}
          className="px-4 py-2 font-semibold text-white bg-blue-500 rounded hover:bg-blue-600"
        >
          Sign out
        </button>
      </header>
      <main className="flex flex-col items-center justify-center flex-grow">
        {!isLocalMode && (
          <>
            <div className="flex items-center mb-4">
              <div
                className={`w-4 h-4 rounded-full mr-2 ${
                  serverRunning ? "bg-green-500" : "bg-gray-500"
                }`}
              ></div>
              <p className="text-xl">
                {serverRunning ? "Trivia server running" : "Trivia server idle"}
              </p>
            </div>
            {!serverRunning && (
              <button
                onClick={startServer}
                className="px-4 py-2 font-semibold text-white bg-blue-500 rounded hover:bg-blue-600 disabled:bg-gray-400"
                disabled={!isHost || isLoading}
              >
                {isLoading ? "Starting server..." : "Start trivia server"}
              </button>
            )}
          </>
        )}
        {(isLocalMode || serverRunning) && (gameCode ? (
          <div className="text-center">
            <p className="text-xl mb-2">Game Code:</p>
            <p className="text-4xl font-bold">{gameCode}</p>
          </div>
        ) : connectionState === "error" && isLocalMode ? (
          <div className="text-center">
            <p className="text-xl text-red-600 mb-4">Local server not running</p>
            <button
              onClick={() => setConnectionState("idle")}
              className="px-4 py-2 font-semibold text-white bg-blue-500 rounded hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        ) : (
          <button
            onClick={startGame}
            disabled={connectionState === "connecting"}
            className="px-4 py-2 font-semibold text-white bg-green-500 rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {connectionState === "connecting" ? "Connecting..." : "Start Game"}
          </button>
        ))}
      </main>
    </div>
  );
}
