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
  if (question.questionData.type !== "standard") {
    return (
      <div className="p-4 text-gray-500">
        Question type "{question.questionData.type}" not yet implemented
      </div>
    );
  }

  // Responses are already ordered by submission time
  const responses = question.questionData.responses;

  // Create a map of team name to team data for quick lookup
  const teamMap = new Map(teams.map((t) => [t.teamName, t]));

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {responses.map((response) => {
        const team = teamMap.get(response.teamName);

        return (
          <AnswerCard
            key={response.teamName}
            teamName={response.teamName}
            answerText={response.answerText}
            teamColor={team?.teamColor.hexCode ? team.teamColor.hexCode : "#666666"}
            score={response.score}
            questionPoints={question.questionPoints}
            bonusIncrement={question.bonusIncrement}
            onScoreChange={(score) => onScoreAnswer(response.teamName, score)}
          />
        );
      })}

      {responses.length === 0 && (
        <div className="text-gray-500 text-center py-8">
          No answers submitted yet
        </div>
      )}
    </div>
  );
}
