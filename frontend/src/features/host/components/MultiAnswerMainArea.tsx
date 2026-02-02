import AnswerList from "./AnswerList";
import AutoSubmitNumericInput from "./AutoSubmitNumericInput";
import type {
  Question,
  TeamData,
  ScoreData,
  MultiAnswerConfig,
} from "../../../types";

interface MultiAnswerMainAreaProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  multiAnswerConfig: MultiAnswerConfig;
  settingsDisabled: boolean;
  onToggleCorrectness: (teamName: string, subAnswerIndex: number) => void;
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
  onMultiAnswerConfigChange: (config: MultiAnswerConfig) => void;
}

export default function MultiAnswerMainArea({
  question,
  questionNumber,
  teams,
  multiAnswerConfig,
  settingsDisabled,
  onToggleCorrectness,
  onScoreAnswer,
  onMultiAnswerConfigChange,
}: MultiAnswerMainAreaProps) {
  const handleNumAnswersChange = (numAnswers: number) => {
    const clamped = Math.max(1, Math.min(10, numAnswers));
    onMultiAnswerConfigChange({ ...multiAnswerConfig, numAnswers: clamped });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center gap-4 p-4 m-4 rounded-2xl bg-gray-100">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">
            Number of answers
          </label>
          <AutoSubmitNumericInput
            value={multiAnswerConfig.numAnswers}
            onSubmit={handleNumAnswersChange}
            disabled={settingsDisabled}
            min={1}
            max={10}
          />
        </div>
        <div className="text-xs text-gray-500">
          {question.questionPoints} pts / {multiAnswerConfig.numAnswers} sub-answers
          = {Math.floor(question.questionPoints / multiAnswerConfig.numAnswers)} pts each
          ({Math.floor(question.questionPoints / multiAnswerConfig.numAnswers) * multiAnswerConfig.numAnswers} total possible)
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <AnswerList
          question={question}
          questionNumber={questionNumber}
          teams={teams}
          onScoreAnswer={onScoreAnswer}
          onToggleCorrectness={onToggleCorrectness}
        />
      </div>
    </div>
  );
}
