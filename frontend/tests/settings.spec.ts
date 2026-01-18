import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { createGame } from './helpers';

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

/**
 * Helper to submit an answer from a team.
 */
async function submitAnswerHelper(teamPage: Page, answer: string): Promise<void> {
  await teamPage.locator('textarea').fill(answer);
  await teamPage.getByRole('button', { name: 'Submit Answer' }).click();
  await expect(teamPage.getByText('Submissions closed.')).toBeVisible();
}

test.describe('Game Settings', () => {
  test.describe('6.2 Settings Restrictions', () => {
    test('question settings disabled after answers submitted', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Find the settings inputs in the footer
      const footerInputs = hostPage.locator('footer input[type="number"]');

      // Initially, settings should be enabled
      await expect(footerInputs.first()).toBeEnabled();

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits an answer
      await submitAnswerHelper(team.page, 'Test Answer');

      // Settings inputs should now be disabled
      await expect(footerInputs.first()).toBeDisabled();
      await expect(footerInputs.nth(1)).toBeDisabled();
      await expect(footerInputs.nth(2)).toBeDisabled();

      // Question type dropdown should also be disabled
      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
      await expect(typeDropdown).toBeDisabled();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('question type cannot be changed after answers submitted', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Verify question type dropdown is initially enabled
      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
      await expect(typeDropdown).toBeEnabled();

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits an answer
      await submitAnswerHelper(team.page, 'Test Answer');

      // Question type dropdown should now be disabled
      await expect(typeDropdown).toBeDisabled();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });

  test.describe('6.1 Per-Question Settings', () => {
    test('host can change question points', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Find the Question Points input (first spinbutton in footer)
      const questionPointsInput = hostPage.locator('footer').getByRole('spinbutton').first();

      // Change the value to 100
      await questionPointsInput.fill('100');
      await questionPointsInput.press('Enter');

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer and submit answer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Test Answer');

      // Find the answer card and mark it correct
      await expect(hostPage.getByText('Test Answer')).toBeVisible();
      const answerCard = hostPage.locator('div').filter({ hasText: 'Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Verify score shows 100 (the new question points value)
      await expect(answerCard.locator('.text-3xl.font-bold')).toHaveText('100');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('host can change bonus increment', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Find the Bonus Increment input (second spinbutton in footer)
      const bonusIncrementInput = hostPage.locator('footer').getByRole('spinbutton').nth(1);

      // Change the value to 25
      await bonusIncrementInput.fill('25');
      await bonusIncrementInput.press('Enter');

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer and submit answer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Bonus Test Answer');

      // Find the answer card
      await expect(hostPage.getByText('Bonus Test Answer')).toBeVisible();
      const answerCard = hostPage.locator('div').filter({ hasText: 'Bonus Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();

      // Add bonus - should add 25 (the new increment value)
      await answerCard.getByRole('button', { name: 'Add bonus points' }).click();

      // Verify score shows 25 (bonus only, no question points)
      await expect(answerCard.locator('.text-3xl.font-bold')).toHaveText('25');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('host can change timer duration', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      await createGame(hostPage);

      // Find the Timer Length input (third spinbutton in footer)
      const timerLengthInput = hostPage.locator('footer').getByRole('spinbutton').nth(2);

      // Change the value to 30 seconds
      await timerLengthInput.fill('30');
      await timerLengthInput.press('Enter');

      // Reset timer to apply new duration
      await hostPage.getByRole('button', { name: 'Reset timer' }).click();

      // Verify timer display shows 0:30
      const timerDisplay = hostPage.locator('.text-4xl').filter({ hasText: /\d+:\d+/ });
      await expect(timerDisplay).toHaveText('0:30');

      // Cleanup
      await hostContext.close();
    });
  });

  test.describe('6.3 Global Game Settings', () => {
    test('host can open settings modal', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Click settings gear icon
      await page.getByRole('button', { name: 'Open settings' }).click();

      // Modal should appear with settings
      await expect(page.getByText('Game Settings')).toBeVisible();
    });
  });
});
