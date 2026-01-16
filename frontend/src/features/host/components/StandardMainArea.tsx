import AnswerList from "./AnswerList";
import type { Question, TeamData, ScoreData } from "../../../types";

interface StandardMainAreaProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
}

export default function StandardMainArea({
  question,
  questionNumber,
  teams,
  onScoreAnswer,
}: StandardMainAreaProps) {
  return (
    <AnswerList
      question={question}
      questionNumber={questionNumber}
      teams={teams}
      onScoreAnswer={onScoreAnswer}
    />
  );
}
