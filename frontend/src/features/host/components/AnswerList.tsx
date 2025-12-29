import AnswerCard from "./AnswerCard";
import type { TeamData, Question, ScoreData } from "../../../types";

interface AnswerListProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
}

export default function AnswerList({
  question,
  teams,
  onScoreAnswer,
}: AnswerListProps) {
  // For now, only handle Standard question type
  if (question.questionKind !== "standard") {
    return (
      <div className="p-4 text-gray-500">
        Question type "{question.questionKind}" not yet implemented
      </div>
    );
  }

  // Answers are already ordered by submission time
  const answers = question.answers;

  // Create a map of team name to team data for quick lookup
  const teamMap = new Map(teams.map((t) => [t.teamName, t]));

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {answers.map((answer) => {
        const team = teamMap.get(answer.teamName);
        // Get answer text from content (only Standard type for now)
        // On host side, content is always present since we only show submitted answers
        const answerText =
          answer.content?.type === "standard" ? answer.content.answerText : "";

        return (
          <AnswerCard
            key={answer.teamName}
            teamName={answer.teamName}
            answerText={answerText}
            teamColor={team?.teamColor.hexCode ? team.teamColor.hexCode : "#666666"}
            score={answer.score}
            questionPoints={question.questionPoints}
            bonusIncrement={question.bonusIncrement}
            onScoreChange={(score) => onScoreAnswer(answer.teamName, score)}
          />
        );
      })}

      {answers.length === 0 && (
        <div className="text-gray-500 text-center py-8">
          No answers submitted yet
        </div>
      )}
    </div>
  );
}
