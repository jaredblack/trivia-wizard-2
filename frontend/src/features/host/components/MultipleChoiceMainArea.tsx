import AnswerList from "./AnswerList";
import McControlsBar from "./McControlsBar";
import type { Question, TeamData, ScoreData, McConfig } from "../../../types";

interface MultipleChoiceMainAreaProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  mcConfig: McConfig;
  settingsDisabled: boolean;
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
  onMcConfigChange: (config: McConfig) => void;
}

export default function MultipleChoiceMainArea({
  question,
  questionNumber,
  teams,
  mcConfig,
  settingsDisabled,
  onScoreAnswer,
  onMcConfigChange,
}: MultipleChoiceMainAreaProps) {
  return (
    <div className="flex flex-col h-full">
      <McControlsBar
        config={mcConfig}
        disabled={settingsDisabled}
        onConfigChange={onMcConfigChange}
      />
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
