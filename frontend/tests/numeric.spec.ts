import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { createGame, startTimer, submitNumericAnswer } from './helpers';

/**
 * Helper to join a team and return the context and page.
 */
async function joinTeamHelper(
  browser: Browser,
  gameCode: string,
  teamName: string,
  memberName: string,
  colorName: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/join');

  await expect(page.getByPlaceholder('Enter game code')).toBeVisible();
  await page.getByPlaceholder('Enter game code').fill(gameCode);
  await page.getByPlaceholder('Enter team name').fill(teamName);
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText("Who's on your team?")).toBeVisible();
  await page.getByPlaceholder('Team member name').first().fill(memberName);
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Choose your team color:')).toBeVisible();
  await page.getByRole('button', { name: `Select ${colorName}` }).click();
  await page.getByRole('button', { name: new RegExp(`Choose ${colorName}`, 'i') }).click();

  await expect(page.getByText('Question 1')).toBeVisible();
  return { context, page };
}

test.describe('Numeric Question Type', () => {
  test('host can switch to numeric question type', async ({ page }) => {
    await page.goto('/host');
    await expect(page.getByText('Server running!')).toBeVisible();
    await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
    await expect(page).toHaveURL('/host/game');

    // Find the question type dropdown and change to Numeric
    const typeDropdown = page.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('numeric');

    // Verify the dropdown now shows Numeric
    await expect(typeDropdown).toHaveValue('numeric');

    // Verify numeric controls appear (correct answer input, scoring dropdown)
    await expect(page.getByText('Correct answer')).toBeVisible();
    await expect(page.getByText('Scoring')).toBeVisible();
  });

  test('team sees numeric input when timer running', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Change to numeric
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('numeric');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await startTimer(hostPage);

    // Team should see numeric input with inputMode="decimal"
    const numericInput = team.page.getByPlaceholder('Enter a number');
    await expect(numericInput).toBeVisible();
    await expect(numericInput).toHaveAttribute('inputMode', 'decimal');

    // Should NOT see a textarea (standard input)
    await expect(team.page.locator('textarea')).not.toBeVisible();

    await team.context.close();
    await hostContext.close();
  });

  test('team can submit numeric answer', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Change to numeric
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('numeric');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await startTimer(hostPage);

    // Submit a numeric answer
    await submitNumericAnswer(team.page, '42');

    // Verify submission shows the answer
    await expect(team.page.getByText('42')).toBeVisible();

    await team.context.close();
    await hostContext.close();
  });

  test('host can set correct answer and scores auto-calculate', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Change to numeric
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('numeric');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await startTimer(hostPage);

    // Submit a numeric answer
    await submitNumericAnswer(team.page, '42');

    // Set correct answer on host
    const correctAnswerInput = hostPage.locator('input[type="number"]').first();
    await correctAnswerInput.fill('42');
    await correctAnswerInput.press('Enter');

    // Wait for score to update in the answer card
    // The answer card should show a score of 50 (default question points)
    const answerCard = hostPage.locator('text=Test Team').locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
    await expect(answerCard.locator('text=50')).toBeVisible();

    await team.context.close();
    await hostContext.close();
  });

  test('host can change scoring mode', async ({ page }) => {
    await page.goto('/host');
    await expect(page.getByText('Server running!')).toBeVisible();
    await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
    await expect(page).toHaveURL('/host/game');

    // Change to numeric
    const typeDropdown = page.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('numeric');

    // Verify default is Exact Only
    const scoringDropdown = page.locator('select').filter({ hasText: /Exact Only/i });
    await expect(scoringDropdown).toBeVisible();

    // Switch to Range
    await scoringDropdown.selectOption('range');
    // Range-specific controls should appear
    await expect(page.getByText('Range type')).toBeVisible();
    await expect(page.getByText('Range value')).toBeVisible();

    // Switch to Closest Guess
    await scoringDropdown.selectOption('closestGuess');
    // Closest Guess-specific controls should appear
    await expect(page.getByText('Winners')).toBeVisible();
    // Range controls should be hidden
    await expect(page.getByText('Range type')).not.toBeVisible();
  });

  test('numeric answer card shows bonus controls but no check/X', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Change to numeric
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('numeric');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await startTimer(hostPage);

    // Submit a numeric answer
    await submitNumericAnswer(team.page, '42');

    // Wait for answer to appear on host
    const answerCard = hostPage.locator('text=Test Team').locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
    await expect(answerCard).toBeVisible();

    // Verify bonus +/- buttons exist
    await expect(answerCard.getByRole('button', { name: /Add bonus points/i })).toBeVisible();
    await expect(answerCard.getByRole('button', { name: /Remove bonus points/i })).toBeVisible();

    // Verify NO check/X buttons (those are for standard answer cards)
    await expect(answerCard.getByRole('button', { name: /Mark correct/i })).not.toBeVisible();
    await expect(answerCard.getByRole('button', { name: /Mark incorrect/i })).not.toBeVisible();

    await team.context.close();
    await hostContext.close();
  });
});
