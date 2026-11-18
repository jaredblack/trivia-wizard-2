import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Reveal from 'reveal.js';
import 'reveal.js/reveal.css';
import './presentation.css';
import type { CompiledDeck } from '../deck/types';
import { webSocketService } from '../services/websocket';
import type { ScoreboardData, ServerMessage } from '../types';
import { loadDeckBundle } from './loadDeck';
import { renderDeck } from './render';
import { fitQuestionSlide } from './fit';
import { usePresentationFonts } from './fonts';
import { listenForGame } from './slidesChannel';

type RevealDeck = InstanceType<typeof Reveal>;

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The slides. On its own this is a deck driven by the arrow keys. Given a game
 * to follow — `?game=CODE`, or announced by a scoring view in the same browser
 * — it becomes a display: the scoring view decides what is on screen, and the
 * slide shows the live game code, countdown and how many teams have answered.
 */
export default function PresentationPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [render, setRender] = useState<{ html: string; bgUrl: string | null } | null>(null);
  const [compiled, setCompiled] = useState<CompiledDeck | null>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<RevealDeck | null>(null);

  const [gameCode, setGameCode] = useState<string | null>(
    () => searchParams.get('game')?.toUpperCase() || null
  );
  const [live, setLive] = useState<ScoreboardData | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);

  usePresentationFonts();

  const cursor = live?.deck && live.deck.uuid === uuid ? live.deck : null;
  const following = cursor !== null;
  // Re-read the deck whenever the scoring view reloads it.
  const deckVersion = cursor?.version ?? 0;

  // Fetch deck + manifests + custom slide HTML, then render.
  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    (async () => {
      try {
        const { deck, ctx } = await loadDeckBundle(uuid);
        if (cancelled) return;
        const fatal = deck.problems.find((p) => p.severity === 'error');
        if (fatal && deck.slides.length <= 1) {
          // Nothing usable came out of the YAML; say why instead of showing a
          // lone title slide.
          setError(fatal.line ? `Line ${fatal.line}: ${fatal.message}` : fatal.message);
          return;
        }
        const out = renderDeck(deck, ctx);
        document.title = deck.title ? `${deck.title} · Slides` : 'Slides';
        setError(null);
        setCompiled(deck);
        setRender({ html: out.slidesHtml, bgUrl: out.bgUrl });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uuid, deckVersion]);

  // Put the slides where the scoring view says they are.
  const applyCursor = useCallback(() => {
    const deck = deckRef.current;
    if (!deck || !cursor || !deck.isReady()) return;
    const last = deck.getTotalSlides() - 1;
    deck.slide(Math.min(cursor.slideIndex, last), 0, cursor.revealed ? 0 : -1);
  }, [cursor]);

  // Initialize reveal.js once slides HTML is in the DOM.
  useEffect(() => {
    if (!render || !revealRef.current) return;
    const deck = new Reveal(revealRef.current, {
      hash: true,
      controls: false,
      progress: false,
      center: false,
      transition: 'none',
      width: 1920,
      height: 1080,
      margin: 0,
    });
    deckRef.current = deck;
    // Shrink an over-long question to fit its slide. Only the current slide can
    // be measured — reveal.js keeps the others display:none, where every box is
    // zero-sized — so fit on entry to each slide, and again once the webfonts
    // land since metrics shift when EB Garamond swaps in.
    let cancelled = false;
    const fitCurrent = () => {
      if (cancelled) return;
      const current = deck.getCurrentSlide();
      if (current instanceof HTMLElement) fitQuestionSlide(current);
    };
    deck.on('ready', fitCurrent);
    deck.on('slidechanged', fitCurrent);
    deck.initialize();
    document.fonts?.ready.then(fitCurrent);

    return () => {
      cancelled = true;
      deck.off('ready', fitCurrent);
      deck.off('slidechanged', fitCurrent);
      deck.destroy();
      if (deckRef.current === deck) deckRef.current = null;
    };
  }, [render]);

  // Follow the cursor: when it moves, and once reveal.js is up after a (re)render.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck || !render) return;
    if (deck.isReady()) {
      applyCursor();
      return;
    }
    deck.on('ready', applyCursor);
    return () => deck.off('ready', applyCursor);
  }, [render, applyCursor]);

  // While following, the keyboard here does nothing: the scoring view drives.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck || !render) return;
    const set = () => deck.configure({ keyboard: !following });
    if (deck.isReady()) {
      set();
      return;
    }
    deck.on('ready', set);
    return () => deck.off('ready', set);
  }, [render, following]);

  // A scoring view in this browser can tell us which game runs this deck.
  useEffect(() => {
    if (!uuid || gameCode) return;
    return listenForGame(uuid, (code) => setGameCode(code.toUpperCase()));
  }, [uuid, gameCode]);

  // Keep the game in the address so a reload goes on following it.
  useEffect(() => {
    if (!gameCode) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('game') === gameCode) return;
    url.searchParams.set('game', gameCode);
    window.history.replaceState(window.history.state, '', url);
  }, [gameCode]);

  // Watch the game.
  useEffect(() => {
    if (!gameCode) return;
    const off = webSocketService.onMessage((message: ServerMessage) => {
      if (message.type === 'scoreboardData') {
        setLive(message.data);
        setSeconds(message.data.timerSecondsRemaining);
        setFollowError(null);
      } else if (message.type === 'timerTick') {
        setSeconds(message.secondsRemaining);
      }
    });
    // Connect on the next tick: the socket service can't have two connection
    // attempts overlap, which is what an effect that is set up, torn down and
    // set up again in quick succession (React's development double-run) would
    // otherwise cause.
    let connected = false;
    const start = setTimeout(() => {
      connected = true;
      webSocketService
        .connectAndSend({ watcher: { watchGame: { gameCode } } })
        .catch((e: unknown) => {
          setFollowError(e instanceof Error ? e.message : String(e));
        });
    }, 0);
    return () => {
      clearTimeout(start);
      off();
      if (connected) {
        webSocketService.clearInitialMessage();
        webSocketService.disconnect();
      }
    };
  }, [gameCode]);

  // The join slide shows the live game code.
  useEffect(() => {
    if (!render || !gameCode || !revealRef.current) return;
    revealRef.current.querySelectorAll('[data-game-code]').forEach((el) => {
      el.textContent = gameCode;
    });
  }, [render, gameCode]);

  if (error) {
    return (
      <div style={{ padding: 20, color: '#b00' }}>
        <h2>Failed to load presentation</h2>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!render) {
    return <div style={{ padding: 20 }}>Loading…</div>;
  }

  const onQuestion =
    following && compiled?.slides[cursor.slideIndex]?.type === 'question';
  const answered = live?.answersReceived ?? 0;
  const teams = live?.teams.length ?? 0;

  return (
    <div
      className="presentation-root"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        ['--bg-url' as string]: render.bgUrl ? `url('${render.bgUrl}')` : 'none',
      } as React.CSSProperties}
    >
      <div className="reveal" ref={revealRef}>
        <div
          className="slides"
          dangerouslySetInnerHTML={{ __html: render.html }}
        />
      </div>
      {onQuestion && live && (
        <div
          className={`slide-status ${live.timerRunning ? 'running' : ''}`}
          data-testid="slide-status"
        >
          {seconds !== null && <span className="slide-timer">{formatTime(seconds)}</span>}
          {teams > 0 && (
            <span className="slide-answered">
              {answered}/{teams} answered
            </span>
          )}
        </div>
      )}
      {followError && gameCode && (
        <div className="slide-follow-error" role="alert">
          Not following game {gameCode}: {followError}
        </div>
      )}
    </div>
  );
}
