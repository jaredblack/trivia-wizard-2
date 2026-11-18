import { Browser, BrowserContext, Page, expect } from '@playwright/test';

/** localStorage key used by the local events backend (services/eventsApi/local.ts). */
const STORE_KEY = 'tw:eventsApi:v1';

// 1x1 transparent PNG, served for every shared image so tests never touch the
// production CDN that the dev server proxies /cdn and /events to.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

export const SHARED_IMAGES = ['bg.png', 'trivia-wizard-join-qr.png', 'globe.jpg'];

/**
 * Seed the browser's local deck store before the app loads and stub the shared
 * asset routes. Call before the first `page.goto`.
 */
export async function seedDecks(
  page: Page,
  decks: Record<string, string>,
  images: Record<string, string[]> = {}
): Promise<void> {
  const events: Record<string, unknown> = {};
  for (const [uuid, yaml] of Object.entries(decks)) {
    events[uuid] = {
      yaml,
      etag: '1',
      lastModified: new Date().toISOString(),
      images: images[uuid] ?? [],
    };
  }
  // On the context, so windows the app opens (the slides popup) get them too.
  const context = page.context();
  await context.addInitScript(
    ([key, value]) => {
      // Only seed once per browser context so edits survive reloads.
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    },
    [STORE_KEY, JSON.stringify({ events })] as const
  );

  await context.route('**/cdn/images/manifest.json', (route) =>
    route.fulfill({ json: SHARED_IMAGES })
  );
  await context.route(/\/cdn\/images\/[^/]+\.(png|jpg)$/, (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  await context.route('**/events/*/images/**', (route) => route.fulfill({ status: 404 }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
}

/** Replace a stored deck's YAML, as if it had been edited and saved elsewhere. */
export async function writeStoredYaml(page: Page, uuid: string, yaml: string): Promise<void> {
  await page.evaluate(
    ([key, id, text]) => {
      const store = JSON.parse(window.localStorage.getItem(key) ?? '{"events":{}}');
      store.events[id].yaml = text;
      store.events[id].etag = String(Number(store.events[id].etag) + 1);
      window.localStorage.setItem(key, JSON.stringify(store));
    },
    [STORE_KEY, uuid, yaml] as const
  );
}

/** The YAML currently stored for a deck. */
export async function storedYaml(page: Page, uuid: string): Promise<string> {
  return page.evaluate(
    ([key, id]) => {
      const store = JSON.parse(window.localStorage.getItem(key) ?? '{"events":{}}');
      return store.events[id]?.yaml ?? '';
    },
    [STORE_KEY, uuid] as const
  );
}

export const NEW_DECK = `title: Test Night
subtitle: Slice one
defaults:
  timer: 60
slides:
- join

- category: Warm Up
  subtitle: Easy ones

- q: What's the capital of France?
  a: Paris

- q: Which planet is known as the red planet?
  a: Mars
  choices: [Venus, Mars, Jupiter]
  image: globe

- q: Rank these by size
  choices: [Mars, Jupiter]
  a:
  - Jupiter
  - Mars

- q: Nie oceniłam pierwszego tomu
- then: I didn't rate the first volume
  a: New Moon

- q: Missing picture
  a: Nothing
  image: not-uploaded
`;

export const OLD_DECK = `title: Old Night
subtitle: 'July 25, 2026'
slides:
  - type: image
    title: |
      Join the game
      Game code: BAGK
    image: trivia-wizard-join-qr
  # planning note
  - type: category
    title: Warm Up
  - type: question
    id: AAA
    question: What's the capital of France?
    answer: Paris
  - type: question
    id: BBB
    question: Which planet is red?
    answer: Mars
    images:
      - url: globe
        reveal: answer
  - type: question
    id: BBB
    question: Same question, second slide
    answer: Still Mars
`;

/** Join a game as a team in its own browser context. */
export async function joinGameAs(
  browser: Browser,
  gameCode: string,
  teamName: string,
  colorName: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/join');
  await page.getByPlaceholder('Enter game code').fill(gameCode);
  await page.getByPlaceholder('Enter team name').fill(teamName);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText("Who's on your team?")).toBeVisible();
  await page.getByPlaceholder('Team member name').first().fill('Player');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Choose your team color:')).toBeVisible();
  await page.getByRole('button', { name: `Select ${colorName}` }).click();
  await page.getByRole('button', { name: new RegExp(`Choose ${colorName}`, 'i') }).click();
  await expect(page.getByText(/Question \d+/).first()).toBeVisible();
  return { context, page };
}
