// How a slides window finds the game it should follow when both are open in
// the same browser: the scoring view announces "this deck is running game X",
// and a slides window showing that deck picks it up. A slides window on another
// device is given the game code in its address instead (?game=CODE).

const CHANNEL = "tw-slides";

type Message =
  | { type: "game"; uuid: string; gameCode: string }
  | { type: "hello"; uuid: string };

const supported = typeof BroadcastChannel !== "undefined";

/** Scoring view: keep telling slides windows which game runs this deck. */
export function announceGame(uuid: string, gameCode: string): () => void {
  if (!supported) return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  const announce = () => channel.postMessage({ type: "game", uuid, gameCode } satisfies Message);
  channel.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === "hello" && e.data.uuid === uuid) announce();
  };
  announce();
  return () => channel.close();
}

/** Slides window: ask for, and listen for, the game running this deck. */
export function listenForGame(uuid: string, onGame: (gameCode: string) => void): () => void {
  if (!supported) return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === "game" && e.data.uuid === uuid) onGame(e.data.gameCode);
  };
  channel.postMessage({ type: "hello", uuid } satisfies Message);
  return () => channel.close();
}
