import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { answerForHost } from "../../../deck/game";
import type { DeckRemote } from "../useDeckRemote";
import type { GameDeck } from "../useGameDeck";

interface DeckBarProps {
  deck: GameDeck;
  remote: DeckRemote;
  questionNumber: number;
  gameCode: string;
  /** Turn the Space / arrow shortcuts off, e.g. while a dialog is open. */
  shortcutsEnabled?: boolean;
}

const isTyping = (el: HTMLElement | null) =>
  !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * The deck a game is running: the current question's text and expected answer,
 * and the one button that walks the slides. Shown only when a deck is attached.
 */
export default function DeckBar({
  deck,
  remote,
  questionNumber,
  gameCode,
  shortcutsEnabled = true,
}: DeckBarProps) {
  // Space or → does the next thing, ← goes back — unless the host is typing.
  const remoteRef = useRef(remote);
  useEffect(() => {
    remoteRef.current = remote;
  });
  useEffect(() => {
    if (!deck.uuid || !shortcutsEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (isTyping(target)) return;
      const r = remoteRef.current;
      if (!r.ready) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!r.primary.disabled) r.primary.run();
      } else if (e.key === " ") {
        // On a button or link, Space already means "press this".
        if (target && ["BUTTON", "A"].includes(target.tagName)) return;
        e.preventDefault();
        if (!r.primary.disabled) r.primary.run();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (r.canBack) r.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.uuid, shortcutsEnabled]);

  if (!deck.uuid) return null;

  const compiled = deck.bundle?.deck ?? null;
  const question = compiled?.questions[questionNumber - 1] ?? null;
  const total = compiled?.questions.length ?? 0;
  const answer = question ? answerForHost(question) : "";
  const errors = compiled?.problems.filter((p) => p.severity === "error").length ?? 0;

  return (
    <section
      className="flex items-start gap-6 px-6 py-3 border-b border-gray-200 bg-amber-50/60"
      aria-label="Deck"
      data-testid="deck-bar"
    >
      <div className="min-w-0 flex-1">
        {deck.status === "loading" && !compiled && (
          <p className="text-gray-600">Loading deck…</p>
        )}
        {deck.status === "error" && (
          <p className="text-red-700" role="alert">
            Couldn't load the deck: {deck.error}
          </p>
        )}
        {compiled && question && (
          <>
            <p className="text-lg leading-snug line-clamp-3" data-testid="deck-question">
              {question.text.trim()}
            </p>
            <p className="mt-1" data-testid="deck-answer">
              <span className="text-sm text-gray-500 mr-2">Answer</span>
              {answer ? (
                <span className="text-lg font-semibold text-red-900">{answer}</span>
              ) : (
                <span className="text-gray-500">not in the deck</span>
              )}
            </p>
          </>
        )}
        {compiled && !question && (
          <p className="text-gray-600" data-testid="deck-question">
            The deck has {total} question{total === 1 ? "" : "s"}; this one isn't in it.
          </p>
        )}
        {errors > 0 && (
          <p className="text-sm text-red-700 mt-1">
            The deck has {errors} problem{errors === 1 ? "" : "s"} to fix in the editor.
          </p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {remote.ready && (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={remote.back}
                disabled={!remote.canBack}
                className="p-2 rounded-full bg-white border border-gray-300 hover:bg-gray-100 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                aria-label="Previous slide"
                title="Previous slide (←)"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={remote.primary.run}
                disabled={remote.primary.disabled}
                data-testid="deck-primary"
                title="Space or →"
                className={`min-w-52 px-5 py-2 rounded-xl font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default ${
                  remote.primary.confirming
                    ? "bg-amber-500 text-black hover:bg-amber-400"
                    : "bg-black text-white hover:bg-gray-800"
                }`}
              >
                {/* A global stylesheet makes buttons inherit their font, so the
                    size goes on a span. */}
                <span className="text-lg">{remote.primary.label}</span>
              </button>
              <button
                type="button"
                onClick={remote.skip}
                disabled={!remote.canSkip}
                className="p-2 rounded-full bg-white border border-gray-300 hover:bg-gray-100 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                aria-label="Next slide"
                title="Next slide, without starting the timer"
              >
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-gray-600" data-testid="deck-on-screen">
              On screen: {remote.onScreen}
            </p>
          </>
        )}
        <p className="text-sm text-gray-600 flex items-center gap-3">
          <a
            href={`/present/${deck.uuid}?game=${encodeURIComponent(gameCode)}`}
            target="_blank"
            rel="noopener"
            className="underline"
          >
            Open slides
          </a>
          <button
            type="button"
            onClick={deck.reload}
            disabled={deck.status === "loading"}
            className="inline-flex items-center gap-1 underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
            title="Re-read the deck. Questions you haven't opened yet pick up the changes."
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {deck.status === "loading" && compiled ? "Reloading…" : "Reload deck"}
          </button>
        </p>
      </div>
    </section>
  );
}
