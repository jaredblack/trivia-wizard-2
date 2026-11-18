import { test, expect, Page } from '@playwright/test';
import { NEW_DECK, OLD_DECK, seedDecks, storedYaml } from './deck-helpers';

const current = (page: Page) => page.locator('.reveal .slides > section.present');

async function advance(page: Page) {
  await page.keyboard.press('ArrowRight');
}

test.describe('Deck format: slides', () => {
  test('renders a deck slide by slide with numbering by order', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/present/deck0001');

    await expect(current(page).locator('.title')).toHaveText('Test Night');
    await expect(current(page).locator('.subtitle')).toHaveText('Slice one');

    await advance(page);
    await expect(current(page)).toHaveClass(/join-slide/);
    await expect(current(page).locator('.image-slide-title')).toContainText('Game code:');
    await expect(current(page).locator('img.image-slide-image')).toBeVisible();

    await advance(page);
    await expect(current(page).locator('.category-title')).toHaveText('Warm Up');
    await expect(current(page).locator('.category-subtitle')).toHaveText('Easy ones');

    await advance(page);
    await expect(current(page).locator('.question-number')).toHaveText('Question 1');
    await expect(current(page).locator('.question-text')).toHaveText("Q: What's the capital of France?");
  });

  test('reveals the answer before moving to the next question', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/present/deck0001#/3');

    const answer = current(page).locator('.answer');
    await expect(current(page).locator('.question-number')).toHaveText('Question 1');
    await expect(answer).not.toHaveClass(/visible/);

    await advance(page);
    await expect(answer).toHaveClass(/visible/);
    await expect(answer).toHaveText('A: Paris');

    await advance(page);
    await expect(current(page).locator('.question-number')).toHaveText('Question 2');
    await expect(current(page).locator('ol.choices li')).toHaveText(['Venus', 'Mars', 'Jupiter']);
    // `image:` shows with the question, without waiting for the reveal.
    await expect(current(page).locator('img.slide-image')).not.toHaveClass(/fragment/);
  });

  test('a list answer replaces the choices on reveal', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/present/deck0001#/5');

    await expect(current(page).locator('.question-number')).toHaveText('Question 3');
    const choices = current(page).locator('ol.choices:not(.answer-list)');
    const ranked = current(page).locator('ol.answer-list');
    await expect(choices.locator('li')).toHaveText(['Mars', 'Jupiter']);
    await expect(ranked).not.toHaveClass(/visible/);

    await advance(page);
    await expect(ranked).toHaveClass(/visible/);
    await expect(ranked.locator('li')).toHaveText(['Jupiter', 'Mars']);
  });

  test('a follow-up slide keeps its question number', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/present/deck0001#/6');

    await expect(current(page).locator('.question-number')).toHaveText('Question 4');
    await expect(current(page).locator('.question-text')).toContainText('Nie oceniłam');

    await advance(page);
    await expect(current(page).locator('.question-number')).toHaveText('Question 4');
    await expect(current(page).locator('.question-text')).toContainText("I didn't rate");

    await advance(page);
    await expect(current(page).locator('.answer')).toHaveText('A: New Moon');

    await advance(page);
    await expect(current(page).locator('.question-number')).toHaveText('Question 5');
  });

  test('a missing image shows a stand-in instead of breaking the deck', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/present/deck0001#/8');

    await expect(current(page).locator('.question-number')).toHaveText('Question 5');
    await expect(current(page).locator('.missing-image')).toHaveText('Image not found: not-uploaded');
  });

  test('an old-format deck still presents', async ({ page }) => {
    await seedDecks(page, { old00001: OLD_DECK });
    await page.goto('/present/old00001');

    await expect(current(page).locator('.title')).toHaveText('Old Night');
    await advance(page);
    await expect(current(page)).toHaveClass(/join-slide/);
    await advance(page);
    await expect(current(page).locator('.category-title')).toHaveText('Warm Up');
    await advance(page);
    await expect(current(page).locator('.question-number')).toHaveText('Question 1');
    await advance(page); // reveal
    await advance(page);
    await expect(current(page).locator('.question-number')).toHaveText('Question 2');
    // `reveal: answer` images wait for the reveal.
    await expect(current(page).locator('img.slide-image')).toHaveClass(/fragment/);
    await advance(page); // reveal
    await advance(page);
    // A repeated id was a second slide of the same question.
    await expect(current(page).locator('.question-number')).toHaveText('Question 2');
    await expect(current(page).locator('.question-text')).toContainText('second slide');
  });
});

test.describe('Deck format: editor', () => {
  // Question numbers shown in the gutter for the lines currently on screen.
  // Monaco recycles line nodes, so DOM order is not document order.
  const gutterNumbers = async (page: Page) => {
    const texts = await page
      .locator('[data-testid="deck-editor"] .line-numbers')
      .filter({ hasText: /\d/ })
      .allTextContents();
    return texts.map(Number).sort((a, b) => a - b);
  };

  test('numbers questions in the gutter and names the tab after the deck', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    await expect(page.locator('[data-testid="deck-editor"] .view-lines')).toContainText('capital of France');
    await expect(page).toHaveTitle('Test Night · Editor');
    await expect.poll(() => gutterNumbers(page)).toEqual([1, 2, 3, 4, 5]);
    await expect(page.getByText('This deck is in the old format')).toHaveCount(0);
    await expect(page.getByText('Editing live data')).toHaveCount(0);
  });

  test('converts an old-format deck in place and saves it', async ({ page }) => {
    await seedDecks(page, { old00001: OLD_DECK });
    await page.goto('/host/events/old00001');

    await expect(page.getByText('This deck is in the old format')).toBeVisible();
    await page.getByRole('button', { name: 'Convert deck' }).click();

    await expect(page.getByText('This deck is in the old format')).toHaveCount(0);
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await expect.poll(() => gutterNumbers(page)).toEqual([1, 2]);

    const yaml = await storedYaml(page, 'old00001');
    expect(yaml).toContain('\n- join\n');
    expect(yaml).toContain('# planning note');
    expect(yaml).toContain("- q: What's the capital of France?\n  a: Paris");
    expect(yaml).toContain('  answer-image: globe');
    expect(yaml).toContain('- then: Same question, second slide');
    expect(yaml).not.toMatch(/^\s*(- )?(type|id):/m);
  });

  test('new-question shortcut adds a question after the current slide', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    // Put the cursor in the middle of question 1.
    await page.locator('[data-testid="deck-editor"] .view-lines').getByText('a: Paris').click();
    await page.keyboard.press('Shift+Alt+KeyQ');
    await page.keyboard.type('Brand new question?');

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const yaml = await storedYaml(page, 'deck0001');
    expect(yaml).toContain('  a: Paris\n- q: Brand new question?\n  a: answer text\n');
    // The new question is number 2 and everything after it shifts down.
    await expect.poll(async () => (await gutterNumbers(page)).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(yaml.indexOf('Brand new question?')).toBeLessThan(yaml.indexOf('red planet'));
  });
});
