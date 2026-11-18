import { test, expect, Page } from '@playwright/test';
import { createGame, submitAnswer, submitNumericAnswer } from './helpers';
import { joinGameAs, seedDecks, writeStoredYaml } from './deck-helpers';

const GAME_DECK = `title: Game Night
defaults:
  timer: 60
slides:
- join

- category: Warm Up

- q: What's the capital of France?
  a: Paris

- q: Most popular vehicle in Massachusetts?
  a: Ford F-150
  choices: [Toyota Rav4, Ford F-150, Honda CR-V]
  points: 20

- category: Date Your Meme
  kind: numeric
  within: 1

- q: "'The Dress' went viral in which year?"
  a: 2015
  timer: 45
  points: 100
`;

/** Create a game from the host landing page with an event selected. */
async function createGameWithDeck(page: Page, deckTitle: string): Promise<string> {
  await page.goto('/host');
  await expect(page.getByText('Server running!')).toBeVisible();
  await page.getByLabel('Event:').selectOption({ label: deckTitle });
  await page
    .getByRole('button', { name: /Create Game/i })
    .filter({ hasText: 'random game code' })
    .click();
  await expect(page).toHaveURL('/host/game');
  const text = await page.locator('text=Game Code:').locator('xpath=..').textContent();
  const code = text?.match(/[A-Z]{4}/)?.[0];
  if (!code) throw new Error('Could not extract game code from page');
  return code;
}

// The header's own controls, by exact label: the deck bar has similarly named ones.
const nextQuestion = (page: Page) => page.getByLabel('Next question').click();
const startTimer = (page: Page) => page.getByLabel('Start timer').click();

const bar = (page: Page) => page.getByTestId('deck-bar');
const typeSelect = (page: Page) => page.locator('header select');
const footerInputs = (page: Page) => page.locator('footer').getByRole('spinbutton');
const answerCards = (page: Page) => page.locator('main').locator('div[class*="rounded-4xl"]');
const scoreOf = (page: Page, index: number) =>
  answerCards(page).nth(index).locator('.text-3xl.font-bold');

test.describe('Deck-driven game', () => {
  test('a game without a deck has no deck bar', async ({ page }) => {
    await seedDecks(page, { deck0001: GAME_DECK });
    await createGame(page);
    await expect(page.getByText('Question', { exact: true })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    await expect(typeSelect(page)).toHaveValue('standard');
    await expect(footerInputs(page).nth(2)).toHaveValue('30');
  });

  test('shows each question with its answer and applies its settings', async ({ page }) => {
    await seedDecks(page, { deck0001: GAME_DECK });
    await createGameWithDeck(page, 'Game Night');

    // Question 1: standard, timer from the deck's defaults, points left alone.
    await expect(page.getByTestId('deck-question')).toHaveText("What's the capital of France?");
    await expect(page.getByTestId('deck-answer')).toContainText('Paris');
    await expect(typeSelect(page)).toHaveValue('standard');
    await expect(footerInputs(page).nth(0)).toHaveValue('50');
    await expect(footerInputs(page).nth(2)).toHaveValue('60');

    // Question 2: choices make it multiple choice with three options.
    await nextQuestion(page);
    await expect(page.getByTestId('deck-question')).toHaveText('Most popular vehicle in Massachusetts?');
    await expect(page.getByTestId('deck-answer')).toContainText('B. Ford F-150');
    await expect(typeSelect(page)).toHaveValue('multipleChoice');
    await expect(footerInputs(page).nth(0)).toHaveValue('20');

    // Question 3: numeric from its category, with its own timer and points.
    await nextQuestion(page);
    await expect(page.getByTestId('deck-answer')).toContainText('2015');
    await expect(typeSelect(page)).toHaveValue('numeric');
    await expect(footerInputs(page).nth(0)).toHaveValue('100');
    await expect(footerInputs(page).nth(2)).toHaveValue('45');
    await expect(
      page.locator('main').getByText('Correct answer').locator('xpath=..').getByRole('spinbutton')
    ).toHaveValue('2015');

    // Past the end of the deck: plain defaults and a note.
    await nextQuestion(page);
    await expect(page.getByTestId('deck-question')).toHaveText(
      "The deck has 3 questions; this one isn't in it."
    );
    await expect(typeSelect(page)).toHaveValue('standard');
    await expect(footerInputs(page).nth(2)).toHaveValue('30');
  });

  test('scores answers on the key as they arrive and leaves the rest', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const host = await hostContext.newPage();
    await seedDecks(host, { deck0001: GAME_DECK });
    const code = await createGameWithDeck(host, 'Game Night');
    const alpha = await joinGameAs(browser, code, 'Team Alpha', 'Orange');
    const beta = await joinGameAs(browser, code, 'Team Beta', 'Blue');

    // Standard question: punctuation and case don't matter.
    await startTimer(host);
    await submitAnswer(alpha.page, ' paris! ');
    await submitAnswer(beta.page, 'London');
    await expect(answerCards(host)).toHaveCount(2);
    await expect(scoreOf(host, 0)).toHaveText('50');
    await expect(scoreOf(host, 1)).toHaveText('0');

    // Multiple choice: the key is the letter of the right choice.
    await nextQuestion(host);
    await expect(alpha.page.getByText('Question 2')).toBeVisible();
    await startTimer(host);
    // Three choices in the deck, so three options on the phone.
    await expect(alpha.page.getByRole('button', { name: 'C', exact: true })).toBeVisible();
    await expect(alpha.page.getByRole('button', { name: 'D', exact: true })).toHaveCount(0);
    await alpha.page.getByRole('button', { name: 'A', exact: true }).click();
    await alpha.page.getByRole('button', { name: 'Submit Answer' }).click();
    await beta.page.getByRole('button', { name: 'B', exact: true }).click();
    await beta.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(answerCards(host)).toHaveCount(2);
    await expect(scoreOf(host, 0)).toHaveText('0');
    await expect(scoreOf(host, 1)).toHaveText('20');

    // Numeric: the correct number is already set, within one year scores.
    await nextQuestion(host);
    await expect(alpha.page.getByText('Question 3')).toBeVisible();
    await startTimer(host);
    await submitNumericAnswer(alpha.page, '2015');
    await submitNumericAnswer(beta.page, '2011');
    await expect(answerCards(host)).toHaveCount(2);
    await expect(scoreOf(host, 0)).toHaveText('100');
    await expect(scoreOf(host, 1)).toHaveText('0');

    await alpha.context.close();
    await beta.context.close();
    await hostContext.close();
  });

  test('live edits win, and reloading the deck only reaches unopened questions', async ({ page }) => {
    await seedDecks(page, { deck0001: GAME_DECK });
    await createGameWithDeck(page, 'Game Night');
    await expect(footerInputs(page).nth(2)).toHaveValue('60');

    // Change question 1's timer by hand.
    await footerInputs(page).nth(2).fill('99');
    await footerInputs(page).nth(2).press('Enter');
    await expect(footerInputs(page).nth(2)).toHaveValue('99');

    // The deck is edited elsewhere: new text for Q1, new answer and points for Q2.
    await writeStoredYaml(
      page,
      'deck0001',
      GAME_DECK.replace("What's the capital of France?", 'Capital of France, please?')
        .replace('timer: 60', 'timer: 15')
        .replace('a: Ford F-150', 'a: Honda CR-V')
        .replace('points: 20', 'points: 70')
    );
    await page.getByRole('button', { name: 'Reload deck' }).click();

    // Question 1 is already open: its text refreshes, its live timer stays.
    await expect(page.getByTestId('deck-question')).toHaveText('Capital of France, please?');
    await expect(footerInputs(page).nth(2)).toHaveValue('99');

    // Question 2 had not been opened, so it takes the reloaded deck.
    await nextQuestion(page);
    await expect(page.getByTestId('deck-answer')).toContainText('C. Honda CR-V');
    await expect(footerInputs(page).nth(0)).toHaveValue('70');
    await expect(footerInputs(page).nth(2)).toHaveValue('15');
  });

  test('the deck stays attached across a host reload', async ({ page }) => {
    await seedDecks(page, { deck0001: GAME_DECK });
    await createGameWithDeck(page, 'Game Night');
    await nextQuestion(page);
    await expect(page.getByTestId('deck-answer')).toContainText('B. Ford F-150');

    await page.reload();
    await expect(page.getByTestId('deck-answer')).toContainText('B. Ford F-150');
    await expect(typeSelect(page)).toHaveValue('multipleChoice');
    await expect(footerInputs(page).nth(0)).toHaveValue('20');
  });
});
