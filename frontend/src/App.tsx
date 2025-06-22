import { ArrowRight } from "lucide-react";

export default function App() {
  const handleStart = () => {
    console.log("Starting trivia game...");
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-700 rounded-lg p-8 w-full max-w-md text-center">
        <h1 className="text-3xl font-bold text-white mb-6">
          Trivia Wizard 2.0
        </h1>
        <button
          onClick={handleStart}
          className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg flex items-center justify-center gap-2 w-full transition-colors"
        >
          Start
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}