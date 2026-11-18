import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clampCursor,
  mainSlideOf,
  nextCursor,
  prevCursor,
  primaryAction,
  questionAt,
  slideLabel,
  type Cursor,
} from "../../deck/runsheet";
import { announceGame } from "../../presentation/slidesChannel";
import { useHostStore } from "../../stores/useHostStore";
import type { ClientMessage } from "../../types";
import type { GameDeck } from "./useGameDeck";

export interface DeckRemote {
  /** False until the deck is attached and loaded. */
  ready: boolean;
  /** Name of the slide on the projector. */
  onScreen: string;
  primary: {
    label: string;
    disabled: boolean;
    /** The button is asking for a second press before revealing. */
    confirming: boolean;
    run: () => void;
  };
  canBack: boolean;
  canSkip: boolean;
  back: () => void;
  /** Move to the next step without starting the timer or anything else. */
  skip: () => void;
}

const IDLE: DeckRemote = {
  ready: false,
  onScreen: "",
  primary: { label: "", disabled: true, confirming: false, run: () => {} },
  canBack: false,
  canSkip: false,
  back: () => {},
  skip: () => {},
};

/**
 * Drives the slides from the scoring view. The cursor lives on the server so
 * the slides window (and a reloaded scoring view) always know where things are.
 */
export function useDeckRemote(
  deck: GameDeck,
  send: (message: ClientMessage) => void
): DeckRemote {
  const gameCode = useHostStore((s) => s.gameCode);
  const attached = useHostStore((s) => s.deck);
  const currentQuestionNumber = useHostStore((s) => s.currentQuestionNumber);
  const timerRunning = useHostStore((s) => s.timerRunning);
  const timerSecondsRemaining = useHostStore((s) => s.timerSecondsRemaining);
  const question = useHostStore((s) => s.questions[s.currentQuestionNumber - 1] ?? null);

  const compiled = deck.bundle?.deck ?? null;
  const ready = !!compiled && !!attached && !!question;

  const slideIndex = attached?.slideIndex ?? 0;
  const revealed = attached?.revealed ?? false;
  const cursor = useMemo<Cursor>(
    () => (compiled ? clampCursor(compiled, { slideIndex, revealed }) : { slideIndex, revealed }),
    [compiled, slideIndex, revealed]
  );

  // Asked once whether to reveal with nothing scored; cleared when things move.
  const [confirmingAt, setConfirmingAt] = useState<string | null>(null);
  const cursorKey = `${cursor.slideIndex}:${cursor.revealed}`;
  const confirming = confirmingAt === cursorKey;

  // Tell slides windows in this browser which game to follow.
  const uuid = attached?.uuid ?? null;
  useEffect(() => {
    if (!uuid || !gameCode) return;
    return announceGame(uuid, gameCode);
  }, [uuid, gameCode]);

  const moveTo = useCallback(
    (to: Cursor) => {
      if (!compiled) return;
      const target = questionAt(compiled, to.slideIndex);
      send({
        host: {
          type: "setDeckCursor",
          slideIndex: to.slideIndex,
          revealed: to.revealed,
          // Sent together so the slides and the game never disagree.
          questionNumber: target !== currentQuestionNumber ? target : undefined,
        },
      });
    },
    [compiled, currentQuestionNumber, send]
  );

  // The header's question arrows still work: when the game moves on its own,
  // the slides follow to that question.
  useEffect(() => {
    if (!compiled || !attached) return;
    if (questionAt(compiled, cursor.slideIndex) === currentQuestionNumber) return;
    const main = mainSlideOf(compiled, currentQuestionNumber);
    if (main === null) return; // past the end of the deck: nothing to show
    send({ host: { type: "setDeckCursor", slideIndex: main, revealed: false } });
  }, [compiled, attached, cursor.slideIndex, currentQuestionNumber, send]);

  if (!ready || !compiled || !question) return IDLE;

  const action = primaryAction(compiled, cursor, {
    currentQuestionNumber,
    timerRunning,
    timerSecondsRemaining,
    timerDuration: question.timerDuration,
    answers: question.answers.length,
  });

  // The game doesn't record whether an answer has been looked at, so the one
  // case worth stopping for is answers in and not a single point given.
  const nothingScored =
    question.answers.length > 0 &&
    question.answers.every((a) => a.score.questionPoints === 0 && a.score.bonusPoints === 0);

  const run = () => {
    switch (action.kind) {
      case "start-timer":
        send({ host: { type: "startTimer" } });
        break;
      case "reveal":
        if (nothingScored && !confirming) {
          setConfirmingAt(cursorKey);
          return;
        }
        setConfirmingAt(null);
        // Showing the answer closes submissions.
        if (timerRunning) send({ host: { type: "pauseTimer" } });
        moveTo({ slideIndex: cursor.slideIndex, revealed: true });
        break;
      case "next":
        moveTo(action.to);
        break;
      case "end":
        break;
    }
  };

  const before = prevCursor(compiled, cursor);
  const after = nextCursor(compiled, cursor);

  return {
    ready: true,
    onScreen: slideLabel(compiled, cursor.slideIndex) + (cursor.revealed ? ", answer showing" : ""),
    primary: {
      label:
        action.kind === "reveal" && confirming ? "Nothing scored yet. Reveal anyway" : action.label,
      disabled: action.kind === "end",
      confirming,
      run,
    },
    canBack: before !== null,
    canSkip: after !== null,
    back: () => before && moveTo(before),
    skip: () => after && moveTo(after),
  };
}
