import AnswerList from "./AnswerList";
import AutoSubmitNumericInput from "./AutoSubmitNumericInput";
import type {
  Question,
  TeamData,
  ScoreData,
  NumericConfig,
  NumericScoringMode,
  NumericRangeType,
} from "../../../types";

interface NumericMainAreaProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  numericConfig: NumericConfig;
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
  onSetCorrectAnswer: (correctAnswer: number | null) => void;
  onNumericConfigChange: (config: NumericConfig) => void;
}

export default function NumericMainArea({
  question,
  questionNumber,
  teams,
  numericConfig,
  onScoreAnswer,
  onSetCorrectAnswer,
  onNumericConfigChange,
}: NumericMainAreaProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-4 p-4 m-4 rounded-2xl bg-gray-100">
        {/* Correct answer input */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">
            Correct answer
          </label>
          <AutoSubmitNumericInput
            value={question.numericCorrectAnswer ?? 0}
            onSubmit={(v) => onSetCorrectAnswer(v)}
            step="any"
            className="w-24 px-2 py-1 border bg-white border-gray-300 hover:border-gray-400 rounded-xl text-center"
          />
          {question.numericCorrectAnswer != null && (
            <button
              onClick={() => onSetCorrectAnswer(null)}
              className="text-xs text-gray-500 hover:text-gray-700 underline cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* Scoring mode dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">
            Scoring
          </label>
          <select
            value={numericConfig.scoringMode}
            onChange={(e) =>
              onNumericConfigChange({
                ...numericConfig,
                scoringMode: e.target.value as NumericScoringMode,
              })
            }
            className="border border-gray-300 bg-white rounded-xl px-2 py-1 hover:bg-gray-50 cursor-pointer"
          >
            <option value="exactOnly">Exact Only</option>
            <option value="range">Range</option>
            <option value="closestGuess">Closest Guess</option>
          </select>
        </div>

        {/* Range-specific controls */}
        {numericConfig.scoringMode === "range" && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">
                Range type
              </label>
              <select
                value={numericConfig.rangeType}
                onChange={(e) =>
                  onNumericConfigChange({
                    ...numericConfig,
                    rangeType: e.target.value as NumericRangeType,
                  })
                }
                className="border border-gray-300 bg-white rounded-xl px-2 py-1 hover:bg-gray-50 cursor-pointer"
              >
                <option value="absolute">Absolute</option>
                <option value="percent">Percent</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">
                Range value
              </label>
              <AutoSubmitNumericInput
                value={numericConfig.rangeValue}
                onSubmit={(v) =>
                  onNumericConfigChange({ ...numericConfig, rangeValue: v })
                }
                step="any"
                min={0}
                className="w-20 px-2 py-1 border bg-white border-gray-300 hover:border-gray-400 rounded-xl text-center"
              />
            </div>
          </>
        )}

        {/* Closest Guess-specific controls */}
        {numericConfig.scoringMode === "closestGuess" && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">
              Winners
            </label>
            <AutoSubmitNumericInput
              value={numericConfig.numWinners}
              onSubmit={(v) =>
                onNumericConfigChange({
                  ...numericConfig,
                  numWinners: Math.max(1, v),
                })
              }
              min={1}
            />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <AnswerList
          question={question}
          questionNumber={questionNumber}
          teams={teams}
          onScoreAnswer={onScoreAnswer}
        />
      </div>
    </div>
  );
}
