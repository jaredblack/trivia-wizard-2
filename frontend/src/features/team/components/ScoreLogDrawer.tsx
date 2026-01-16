import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ScoreData, TeamQuestion } from "../../../types";
import { answerToString } from "../../../types";

interface ScoreLogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  teamName: string;
  totalScore: ScoreData;
  questions: TeamQuestion[];
}

export default function ScoreLogDrawer({
  isOpen,
  onClose,
  teamName,
  totalScore,
  questions,
}: ScoreLogDrawerProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Handle animation timing
  useEffect(() => {
    if (isOpen) {
      // Small delay to trigger transition
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Handle closing with animation
  const handleClose = () => {
    setIsVisible(false);
    // Wait for animation to finish before actually closing
    setTimeout(onClose, 300);
  };

  if (!isOpen) return null;

  // Reverse questions for display (most recent first)
  const reversedQuestions = [...questions].reverse();

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        isVisible ? "bg-black/50" : "bg-transparent"
      }`}
      onClick={handleClose}
    >
      <div
        className={`absolute bottom-0 left-0 right-0 h-[80%] bg-white rounded-t-2xl shadow-lg transform transition-transform duration-300 ease-out ${
          isVisible ? "translate-y-0" : "translate-y-full"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-xl font-bold">Score Log</h2>
            <p className="text-gray-600">{teamName}</p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Total Score Summary */}
        <div className="px-4 py-3 bg-gray-50 border-b">
          <p className="text-sm text-gray-600">
            Questions: {totalScore.questionPoints}, Bonus: {totalScore.bonusPoints}, Override: {totalScore.overridePoints}
          </p>
        </div>

        {/* Questions List */}
        <div className="overflow-y-auto h-[calc(100%-120px)]">
          {reversedQuestions.map((question, index) => {
            const questionNumber = questions.length - index;
            return (
              <div key={questionNumber} className="p-4 border-b">
                <h3 className="font-semibold mb-2">Question {questionNumber}:</h3>
                <p className="text-gray-700 mb-1">
                  Your answer:{" "}
                  {question.content
                    ? answerToString(question.content)
                    : <span className="text-gray-400 italic">No answer submitted</span>}
                </p>
                <p className="text-sm text-gray-600">
                  Score: Question: {question.score.questionPoints}, Bonus: {question.score.bonusPoints}
                </p>
              </div>
            );
          })}
          {questions.length === 0 && (
            <div className="p-4 text-gray-500 text-center">
              No questions yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
