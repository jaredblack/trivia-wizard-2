import AnswerCard from "./AnswerCard";
import MultiAnswerAnswerCard from "./MultiAnswerAnswerCard";
import type { TeamData, Question, ScoreData } from "../../../types";
import { answerToString } from "../../../types";

interface AnswerListProps {
  question: Question;
  questionNumber: number;
  teams: TeamData[];
  onScoreAnswer: (teamName: string, score: ScoreData) => void;
  onToggleCorrectness?: (teamName: string, subAnswerIndex: number) => void;
}

export default function AnswerList({
  question,
  teams,
  onScoreAnswer,
  onToggleCorrectness,
}: AnswerListProps) {
  // Answers are already ordered by submission time
  const answers = question.answers;

  // Create a map of team name to team data for quick lookup
  const teamMap = new Map(teams.map((t) => [t.teamName, t]));

  const isMultiAnswer = question.questionConfig.type === "multiAnswer";

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {answers.map((answer) => {
        const team = teamMap.get(answer.teamName);
        const teamColor = team?.teamColor.hexCode ?? "#666666";

        if (isMultiAnswer && answer.content?.type === "multi") {
          return (
            <MultiAnswerAnswerCard
              key={answer.teamName}
              teamName={answer.teamName}
              answers={answer.content.answers}
              correct={answer.content.correct}
              teamColor={teamColor}
              score={answer.score}
              bonusIncrement={question.bonusIncrement}
              onToggleCorrectness={(subAnswerIndex) =>
                onToggleCorrectness?.(answer.teamName, subAnswerIndex)
              }
              onScoreChange={(score) => onScoreAnswer(answer.teamName, score)}
            />
          );
        }

        // Standard / Multiple Choice answer card
        const answerText = answer.content ? answerToString(answer.content) : "";
        return (
          <AnswerCard
            key={answer.teamName}
            teamName={answer.teamName}
            answerText={answerText}
            teamColor={teamColor}
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
