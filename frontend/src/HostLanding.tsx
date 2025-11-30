import { useOutletContext } from "react-router-dom";
import type { AuthOutletContext } from "./ProtectedRoute";
import { useEffect, useState } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import { getCredentials } from "./aws";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";

export default function HostLanding() {
  const { user, signOut } = useOutletContext<AuthOutletContext>();
  const [serverRunning, setServerRunning] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
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

  const pollServerStatus = () => {
    console.log("trying to poll server status");
    const interval = setInterval(async () => {
      try {
        const response = await fetch("https://ws.trivia.jarbla.com/health", { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          setServerRunning(true);
          setIsLoading(false);
          clearInterval(interval);
        }
      } catch (error) {
        console.log(`server not ready yet: ${error}`);
        // Server is not ready yet
      }
    }, 5000); // Poll every 5 seconds

    // Stop polling after 2 minutes
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

  const startGame = () => {
    const ws = new WebSocket("ws://ws.trivia.jarbla.com:9002");

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      console.log("Message from server: ", event.data);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    ws.onerror = (error) => {
      console.error("WebSocket error: ", error);
    };
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
        {!serverRunning ? (
          <button
            onClick={startServer}
            className="px-4 py-2 font-semibold text-white bg-blue-500 rounded hover:bg-blue-600 disabled:bg-gray-400"
            disabled={!isHost || isLoading}
          >
            {isLoading ? "Starting server..." : "Start trivia server"}
          </button>
        ) : (
          <button
            onClick={startGame}
            className="px-4 py-2 font-semibold text-white bg-green-500 rounded hover:bg-green-600"
          >
            Start Game
          </button>
        )}
      </main>
    </div>
  );
}
