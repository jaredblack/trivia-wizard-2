import { Play, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import type { QuestionKind } from "../../../types";

interface QuestionControlsProps {
  questionNumber: number;
  questionType: QuestionKind;
  timerDuration: number;
  onExit: () => void;
}

export default function QuestionControls({
  questionNumber,
  questionType,
  timerDuration,
  onExit,
}: QuestionControlsProps) {
  // Format timer as M:SS
  const minutes = Math.floor(timerDuration / 60);
  const seconds = timerDuration % 60;
  const timerDisplay = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  // Map question type to display label
  const typeLabels: Record<QuestionKind, string> = {
    standard: "Standard",
    multiAnswer: "Multi-Answer",
    multipleChoice: "Multiple Choice",
  };

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
      {/* Logo */}
      <h1
        className="text-2xl font-bold"
        style={{ fontFamily: "Birthstone, cursive" }}
      >
        Trivia Wizard <span className="text-red-500">2.0!</span>
      </h1>

      {/* Question info and timer */}
      <div className="flex items-center gap-6">
        {/* Question number */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Question</span>
          <span className="text-4xl font-bold">{questionNumber}</span>
        </div>

        {/* Question type dropdown */}
        <div className="flex flex-col">
          <span className="text-sm text-gray-500">Type</span>
          <select
            value={questionType}
            onChange={() => {}}
            className="border border-gray-300 rounded px-2 py-1"
          >
            <option value="standard">{typeLabels.standard}</option>
            <option value="multiAnswer">{typeLabels.multiAnswer}</option>
            <option value="multipleChoice">{typeLabels.multipleChoice}</option>
          </select>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-2">
          <button
            className="p-2 hover:bg-gray-100 rounded-full"
            aria-label="Start timer"
          >
            <Play className="w-6 h-6" />
          </button>
          <span className="text-4xl font-mono font-bold">{timerDisplay}</span>
          <button
            className="p-2 hover:bg-gray-100 rounded-full"
            aria-label="Reset timer"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation arrows */}
        <div className="flex items-center gap-1">
          <button
            className="p-2 hover:bg-gray-100 rounded-full"
            aria-label="Previous question"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            className="p-2 hover:bg-gray-100 rounded-full"
            aria-label="Next question"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Exit button */}
      <button
        onClick={onExit}
        className="text-gray-600 hover:text-gray-900 underline"
      >
        Exit Game
      </button>
    </header>
  );
}
