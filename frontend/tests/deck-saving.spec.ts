import { test, expect, Page } from '@playwright/test';
import { NEW_DECK, seedDecks, storedYaml } from './deck-helpers';

const STORE_KEY = 'tw:eventsApi:v1';
const lines = (page: Page) => page.locator('[data-testid="deck-editor"] .view-lines');

async function typeAtEndOf(page: Page, text: string, addition: string) {
  await lines(page).getByText(text).click();
  await page.keyboard.press('End');
  await page.keyboard.type(addition);
}

test.describe('Deck saving', () => {
  test('a failed save stops editing, says why, and recovers on retry', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');
    await expect(lines(page)).toContainText('capital of France');

    // Make the next save fail: the deck disappears from storage.
    const saved = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key)!;
      window.localStorage.setItem(key, JSON.stringify({ events: {} }));
      return raw;
    }, STORE_KEY);

    await typeAtEndOf(page, 'a: Paris', ', France');
    const alert = page.getByRole('alert').filter({ hasText: "Couldn't save" });
    await expect(alert).toContainText('No such event: deck0001');
    await expect(page.getByText('Not saved', { exact: true })).toBeVisible();

    // Further typing is refused rather than silently lost.
    await page.keyboard.type(' and more');
    await expect(lines(page)).toContainText('a: Paris, France');
    await expect(lines(page)).not.toContainText('and more');

    // Storage comes back; retrying saves what was typed and unlocks the editor.
    await page.evaluate(([key, raw]) => window.localStorage.setItem(key, raw), [STORE_KEY, saved] as const);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
    expect(await storedYaml(page, 'deck0001')).toContain('  a: Paris, France\n');

    await page.keyboard.type('!');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  a: Paris, France!\n');
  });

  test('a deck changed elsewhere is not overwritten', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');
    await expect(lines(page)).toContainText('capital of France');

    // Someone else saves a different version.
    const theirs = NEW_DECK.replace('Test Night', 'Their Night');
    await page.evaluate(
      ([key, yaml]) => {
        const store = JSON.parse(window.localStorage.getItem(key)!);
        store.events.deck0001.yaml = yaml;
        store.events.deck0001.etag = '99';
        window.localStorage.setItem(key, JSON.stringify(store));
      },
      [STORE_KEY, theirs] as const
    );

    await typeAtEndOf(page, 'a: Paris', '?');
    // (The editor has alert regions of its own, so match ours by its text.)
    await expect(
      page.getByRole('alert').filter({ hasText: 'saved somewhere else since you opened it' })
    ).toBeVisible();
    // Editing is paused, and their version is still what is stored.
    await page.keyboard.type('!!');
    await expect(lines(page)).not.toContainText('?!!');
    expect(await storedYaml(page, 'deck0001')).toBe(theirs);
  });
});
