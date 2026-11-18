import { test, expect, Browser, Page } from '@playwright/test';
import { submitAnswer } from './helpers';
import { joinGameAs, seedDecks, writeStoredYaml } from './deck-helpers';

// Slides: 0 title, 1 join, 2 category, 3 Q1, 4 Q2, 5 category, 6 Q3.
const DECK = `title: Remote Night
slides:
- join

- category: Warm Up

- q: What's the capital of France?
  a: Paris

- q: Most popular vehicle in Massachusetts?
  a: Ford F-150
  choices: [Toyota Rav4, Ford F-150, Honda CR-V]

- category: Finale

- q: "'The Dress' went viral in which year?"
  a: 2015
  kind: numeric
`;

/** Start a game from a deck; returns the scoring view and the slides popup. */
async function startDeckGame(browser: Browser) {
  const context = await browser.newContext();
  const host = await context.newPage();
  await seedDecks(host, { deck0001: DECK });
  await host.goto('/host');
  await expect(host.getByText('Server running!')).toBeVisible();
  await host.getByLabel('Event:').selectOption({ label: 'Remote Night' });
  const popup = context.waitForEvent('page');
  await host
    .getByRole('button', { name: /Create Game/i })
    .filter({ hasText: 'random game code' })
    .click();
  const slides = await popup;
  await expect(host).toHaveURL('/host/game');
  const text = await host.locator('text=Game Code:').locator('xpath=..').textContent();
  const code = text?.match(/[A-Z]{4}/)?.[0];
  if (!code) throw new Error('Could not extract game code from page');
  await expect(primary(host)).toBeVisible();
  return { context, host, slides, code };
}

const primary = (host: Page) => host.getByTestId('deck-primary');
const onScreen = (host: Page) => host.getByTestId('deck-on-screen');
const current = (slides: Page) => slides.locator('.reveal .slides > section.present');
const hostQuestionNumber = (host: Page) => host.locator('header .text-4xl.font-bold').first();

/** Press the primary button, checking it says what we expect first. */
async function step(host: Page, label: string) {
  await expect(primary(host)).toHaveText(label);
  await primary(host).click();
}

test.describe('Scoring view drives the slides', () => {
  test('one button walks a question from slide to reveal to the next', async ({ browser }) => {
    const { context, host, slides, code } = await startDeckGame(browser);

    await expect(current(slides).locator('.title')).toHaveText('Remote Night');
    await expect(onScreen(host)).toHaveText('On screen: Title');

    // The join slide shows the live game code.
    await step(host, 'Next: Join slide');
    await expect(current(slides)).toHaveClass(/join-slide/);
    await expect(current(slides).locator('[data-game-code]')).toHaveText(code);

    await step(host, 'Next: Category: Warm Up');
    await expect(current(slides).locator('.category-title')).toHaveText('Warm Up');
    // A category slide doesn't move the game: still on question 1.
    await expect(hostQuestionNumber(host)).toHaveText('1');

    await step(host, 'Show Q1');
    await expect(current(slides).locator('.question-number')).toHaveText('Question 1');
    await expect(onScreen(host)).toHaveText('On screen: Q1');
    // Showing the question does not start the timer.
    await expect(host.getByLabel('Start timer')).toBeVisible();

    const team = await joinGameAs(browser, code, 'Team Alpha', 'Orange');
    await step(host, 'Start timer');
    await expect(host.getByRole('button', { name: 'Pause timer' })).toBeVisible();

    // The projector shows the countdown and who has answered.
    const status = slides.getByTestId('slide-status');
    await expect(status).toHaveClass(/running/);
    await expect(status).toContainText('0/1 answered');
    await submitAnswer(team.page, 'Paris');
    await expect(status).toContainText('1/1 answered');

    await expect(current(slides).locator('.answer')).not.toHaveClass(/visible/);
    await step(host, 'Reveal answer');
    await expect(current(slides).locator('.answer')).toHaveClass(/visible/);
    await expect(onScreen(host)).toHaveText('On screen: Q1, answer showing');

    // Moving to the next question's slide moves the game with it.
    await step(host, 'Show Q2');
    await expect(current(slides).locator('.question-number')).toHaveText('Question 2');
    await expect(hostQuestionNumber(host)).toHaveText('2');
    await expect(host.getByTestId('deck-answer')).toContainText('B. Ford F-150');
    await expect(team.page.getByText('Question 2')).toBeVisible();

    // Back returns to question 1 as it was left: answer showing.
    await host.getByRole('button', { name: 'Previous slide' }).click();
    await expect(current(slides).locator('.question-number')).toHaveText('Question 1');
    await expect(current(slides).locator('.answer')).toHaveClass(/visible/);
    await expect(hostQuestionNumber(host)).toHaveText('1');

    await team.context.close();
    await context.close();
  });

  test('asks before revealing when nothing has been scored', async ({ browser }) => {
    const { context, host, slides, code } = await startDeckGame(browser);
    const team = await joinGameAs(browser, code, 'Team Alpha', 'Orange');

    await host.getByRole('button', { name: 'Next slide' }).click();
    await host.getByRole('button', { name: 'Next slide' }).click();
    await step(host, 'Show Q1');
    await step(host, 'Start timer');
    await submitAnswer(team.page, 'London');

    await step(host, 'Reveal answer');
    await expect(primary(host)).toHaveText('Nothing scored yet. Reveal anyway');
    await expect(current(slides).locator('.answer')).not.toHaveClass(/visible/);

    await primary(host).click();
    await expect(current(slides).locator('.answer')).toHaveClass(/visible/);
    await expect(primary(host)).toHaveText('Show Q2');

    await team.context.close();
    await context.close();
  });

  test('revealing closes submissions', async ({ browser }) => {
    const { context, host, code } = await startDeckGame(browser);
    const alpha = await joinGameAs(browser, code, 'Team Alpha', 'Orange');
    const beta = await joinGameAs(browser, code, 'Team Beta', 'Blue');

    await host.getByRole('button', { name: 'Next slide' }).click();
    await host.getByRole('button', { name: 'Next slide' }).click();
    await step(host, 'Show Q1');
    await step(host, 'Start timer');
    // One team is right (scored from the key); the other hasn't answered.
    await submitAnswer(alpha.page, 'Paris');
    await expect(host.getByRole('button', { name: 'Pause timer' })).toBeVisible();

    await step(host, 'Reveal answer');
    await expect(host.getByLabel('Start timer')).toBeVisible();
    await expect(beta.page.locator('textarea')).toHaveCount(0);

    await alpha.context.close();
    await beta.context.close();
    await context.close();
  });

  test('keyboard and the header arrows keep slides and game together', async ({ browser }) => {
    const { context, host, slides } = await startDeckGame(browser);

    // Arrow keys and Space step the slides when nothing is being typed.
    await host.locator('body').press('ArrowRight');
    await expect(current(slides)).toHaveClass(/join-slide/);
    await host.locator('body').press(' ');
    await expect(current(slides).locator('.category-title')).toHaveText('Warm Up');
    await host.locator('body').press('ArrowLeft');
    await expect(current(slides)).toHaveClass(/join-slide/);

    // Typing in a settings field doesn't move anything.
    const points = host.locator('footer').getByRole('spinbutton').first();
    await points.click();
    await points.press('ArrowRight');
    await expect(current(slides)).toHaveClass(/join-slide/);

    // The header's own next-question arrow takes the slides to that question.
    await host.getByRole('button', { name: 'Next question' }).click();
    await expect(hostQuestionNumber(host)).toHaveText('2');
    await expect(current(slides).locator('.question-number')).toHaveText('Question 2');
    await expect(onScreen(host)).toHaveText('On screen: Q2');

    await host.getByRole('button', { name: 'Previous question' }).click();
    await expect(current(slides).locator('.question-number')).toHaveText('Question 1');

    // The slides window itself ignores the keyboard while it is following.
    await slides.keyboard.press('ArrowRight');
    await slides.keyboard.press('ArrowRight');
    await expect(current(slides).locator('.question-number')).toHaveText('Question 1');

    await context.close();
  });

  test('a slides window opened later, or reloaded, catches up', async ({ browser }) => {
    const { context, host, slides, code } = await startDeckGame(browser);
    await host.getByRole('button', { name: 'Next slide' }).click();
    await host.getByRole('button', { name: 'Next slide' }).click();
    await step(host, 'Show Q1');
    await expect(current(slides).locator('.question-number')).toHaveText('Question 1');

    // Its address now carries the game, so a reload keeps following.
    await expect(slides).toHaveURL(new RegExp(`\\?game=${code}`));
    await slides.reload();
    await expect(current(slides).locator('.question-number')).toHaveText('Question 1');

    // A second window from the "Open slides" link lands on the same slide.
    const opened = context.waitForEvent('page');
    await host.getByRole('link', { name: 'Open slides' }).click();
    const second = await opened;
    await expect(current(second).locator('.question-number')).toHaveText('Question 1');

    await host.getByRole('button', { name: 'Next slide' }).click();
    await expect(current(second).locator('.answer')).toHaveClass(/visible/);
    await expect(current(slides).locator('.answer')).toHaveClass(/visible/);

    await context.close();
  });

  test('reloading the deck updates the slides too', async ({ browser }) => {
    const { context, host, slides } = await startDeckGame(browser);

    await writeStoredYaml(
      host,
      'deck0001',
      DECK.replace('Most popular vehicle in Massachusetts?', 'Top-selling vehicle in Massachusetts?')
    );
    await host.getByRole('button', { name: 'Reload deck' }).click();
    await expect(host.getByRole('button', { name: 'Reload deck' })).toBeEnabled();

    await host.getByRole('button', { name: 'Next question' }).click();
    await expect(host.getByTestId('deck-question')).toHaveText('Top-selling vehicle in Massachusetts?');
    await expect(current(slides).locator('.question-text')).toHaveText(
      'Q: Top-selling vehicle in Massachusetts?'
    );

    await context.close();
  });
});
