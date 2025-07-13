import { useOutletContext } from "react-router-dom";
import type { AuthOutletContext } from "./ProtectedRoute";
import { useState } from "react";

export default function HostLanding() {
  const { user, signOut } = useOutletContext<AuthOutletContext>();
  const [serverRunning, setServerRunning] = useState(false);

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
        <button
          onClick={() => setServerRunning(!serverRunning)}
          className="px-4 py-2 font-semibold text-white bg-blue-500 rounded hover:bg-blue-600"
        >
          {serverRunning ? "Stop trivia server" : "Start trivia server"}
        </button>
      </main>
    </div>
  );
}