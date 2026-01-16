import { Play, Pause, RotateCcw, ArrowLeft, ArrowRight } from "lucide-react";
import { questionKindLabels } from "../../../types";
import type { QuestionKind } from "../../../types";
import TimerDisplay from "../../../components/ui/TimerDisplay";

interface QuestionControlsProps {
  questionNumber: number;
  questionType: QuestionKind;
  timerSeconds: number;
  timerRunning: boolean;
  settingsDisabled?: boolean;
  onStartTimer: () => void;
  onPauseTimer: () => void;
  onResetTimer: () => void;
  onPrevQuestion: () => void;
  onNextQuestion: () => void;
  onQuestionTypeChange?: (type: QuestionKind) => void;
  onExit: () => void;
}

export default function QuestionControls({
  questionNumber,
  questionType,
  timerSeconds,
  timerRunning,
  settingsDisabled,
  onStartTimer,
  onPauseTimer,
  onResetTimer,
  onPrevQuestion,
  onNextQuestion,
  onQuestionTypeChange,
  onExit,
}: QuestionControlsProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
      {/* Logo */}
      <h1 className="text-3xl font-bold">
        Trivia Wizard{" "}
        <span
          style={{ fontFamily: "Birthstone, cursive" }}
          className="text-red-500 text-4xl"
        >
          2.0!
        </span>
      </h1>

      {/* Question info and timer */}
      <div className="flex items-center gap-6 bg-gray-100 px-4 py-2 rounded-2xl">
        {/* Question number */}
        <div className="flex flex-col items-center">
          <span className="text-sm text-gray-500">Question</span>
          <span className="text-4xl font-bold">{questionNumber}</span>
        </div>

        {/* Question type dropdown */}
        <div className="flex flex-col">
          <span className="text-sm text-gray-500">Type</span>
          <select
            value={questionType}
            onChange={(e) =>
              onQuestionTypeChange?.(e.target.value as QuestionKind)
            }
            disabled={settingsDisabled}
            className={`border border-gray-300 bg-white rounded-xl px-2 py-2 ${
              settingsDisabled
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "hover:bg-gray-200 cursor-pointer"
            }`}
          >
            <option value="standard">{questionKindLabels.standard}</option>
            <option value="multiAnswer">{questionKindLabels.multiAnswer}</option>
            <option value="multipleChoice">{questionKindLabels.multipleChoice}</option>
          </select>
        </div>

        {/* Timer */}
        <div className="flex items-center gap-2 bg-white rounded-2xl p-2">
          <button
            onClick={timerRunning ? onPauseTimer : onStartTimer}
            className="p-2 hover:bg-gray-100 rounded-full cursor-pointer"
            aria-label={timerRunning ? "Pause timer" : "Start timer"}
          >
            {timerRunning ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6" />
            )}
          </button>
          <TimerDisplay seconds={timerSeconds} className="text-4xl" />
          <button
            onClick={onResetTimer}
            className="p-2 hover:bg-gray-100 rounded-full cursor-pointer"
            aria-label="Reset timer"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation arrows */}
        <div className="flex items-center gap-1">
          <button
            onClick={onPrevQuestion}
            disabled={questionNumber <= 1}
            className="p-2 hover:bg-gray-200 rounded-full bg-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Previous question"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <button
            onClick={onNextQuestion}
            className="p-2 hover:bg-gray-200 rounded-full bg-white cursor-pointer"
            aria-label="Next question"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Exit button */}
      <button
        onClick={onExit}
        className="text-gray-600 hover:text-gray-900 underline cursor-pointer"
      >
        Exit Game
      </button>
    </header>
  );
}
