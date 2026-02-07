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
    test('question settings granular disable after answers and scoring', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Find the settings inputs in the footer
      const questionPointsInput = hostPage.locator('footer').getByRole('spinbutton').first();
      const bonusIncrementInput = hostPage.locator('footer').getByRole('spinbutton').nth(1);
      const timerLengthInput = hostPage.locator('footer').getByRole('spinbutton').nth(2);
      const speedBonusButton = hostPage.locator('footer button', { hasText: 'Speed' });
      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });

      // Initially, all settings should be enabled
      await expect(questionPointsInput).toBeEnabled();
      await expect(bonusIncrementInput).toBeEnabled();
      await expect(timerLengthInput).toBeEnabled();
      await expect(speedBonusButton).toBeEnabled();
      await expect(typeDropdown).toBeEnabled();

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits an answer
      await submitAnswerHelper(team.page, 'Test Answer');

      // After submission (but no scoring):
      // - Question type should be disabled (has answers)
      // - Question points, bonus increment should be enabled (no scored answers)
      // - Timer should be enabled (timer auto-paused since all teams submitted)
      // - Speed bonus should always be enabled
      await expect(typeDropdown).toBeDisabled();
      await expect(questionPointsInput).toBeEnabled();
      await expect(bonusIncrementInput).toBeEnabled();
      await expect(timerLengthInput).toBeEnabled();
      await expect(speedBonusButton).toBeEnabled();

      // Score the answer correct
      const answerCard = hostPage.locator('div').filter({ hasText: 'Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // After scoring:
      // - Question points and bonus increment should be disabled
      // - Timer and speed bonus should remain enabled
      await expect(questionPointsInput).toBeDisabled();
      await expect(bonusIncrementInput).toBeDisabled();
      await expect(timerLengthInput).toBeEnabled();
      await expect(speedBonusButton).toBeEnabled();

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

  test.describe('Late Settings Adjustment', () => {
    test('timer duration editable after answers submitted', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Submit answer (auto-pauses timer)
      await submitAnswerHelper(team.page, 'Test Answer');

      // Timer input should still be enabled
      const timerLengthInput = hostPage.locator('footer').getByRole('spinbutton').nth(2);
      await expect(timerLengthInput).toBeEnabled();

      // Change timer duration
      await timerLengthInput.fill('45');
      await timerLengthInput.press('Enter');

      // Reset timer to see new value
      await hostPage.getByRole('button', { name: 'Reset timer' }).click();
      const timerDisplay = hostPage.locator('.text-4xl').filter({ hasText: /\d+:\d+/ });
      await expect(timerDisplay).toHaveText('0:45');

      await team.context.close();
      await hostContext.close();
    });

    test('timer duration disabled while timer is running', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      await createGame(hostPage);

      const timerLengthInput = hostPage.locator('footer').getByRole('spinbutton').nth(2);

      // Initially enabled (timer not running)
      await expect(timerLengthInput).toBeEnabled();

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Timer input should be disabled while running
      await expect(timerLengthInput).toBeDisabled();

      // Pause timer
      await hostPage.getByRole('button', { name: 'Pause timer' }).click();

      // Timer input should be re-enabled
      await expect(timerLengthInput).toBeEnabled();

      await hostContext.close();
    });

    test('question points and bonus increment editable after answers but before scoring', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      const questionPointsInput = hostPage.locator('footer').getByRole('spinbutton').first();
      const bonusIncrementInput = hostPage.locator('footer').getByRole('spinbutton').nth(1);

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Submit answer
      await submitAnswerHelper(team.page, 'Test Answer');

      // Both should still be enabled (no scoring yet)
      await expect(questionPointsInput).toBeEnabled();
      await expect(bonusIncrementInput).toBeEnabled();

      // Change question points
      await questionPointsInput.fill('100');
      await questionPointsInput.press('Enter');

      // Score the answer and verify it uses the new value
      const answerCard = hostPage.locator('div').filter({ hasText: 'Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Score should show 100 (the new value)
      await expect(answerCard.locator('.text-3xl.font-bold')).toHaveText('100');

      await team.context.close();
      await hostContext.close();
    });

    test('question points and bonus increment disabled after scoring', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      const questionPointsInput = hostPage.locator('footer').getByRole('spinbutton').first();
      const bonusIncrementInput = hostPage.locator('footer').getByRole('spinbutton').nth(1);

      // Start timer, submit answer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Test Answer');

      // Score the answer correct
      const answerCard = hostPage.locator('div').filter({ hasText: 'Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Both should now be disabled
      await expect(questionPointsInput).toBeDisabled();
      await expect(bonusIncrementInput).toBeDisabled();

      await team.context.close();
      await hostContext.close();
    });

    test('question points and bonus increment re-enable after clearing scores', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      const questionPointsInput = hostPage.locator('footer').getByRole('spinbutton').first();
      const bonusIncrementInput = hostPage.locator('footer').getByRole('spinbutton').nth(1);

      // Start timer, submit answer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Test Answer');

      // Score the answer correct
      const answerCard = hostPage.locator('div').filter({ hasText: 'Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Verify disabled
      await expect(questionPointsInput).toBeDisabled();
      await expect(bonusIncrementInput).toBeDisabled();

      // Mark incorrect (clears score to 0)
      await answerCard.getByRole('button', { name: 'Mark incorrect' }).click();

      // Should be re-enabled
      await expect(questionPointsInput).toBeEnabled();
      await expect(bonusIncrementInput).toBeEnabled();

      await team.context.close();
      await hostContext.close();
    });

    test('speed bonus toggle always enabled', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      const speedBonusButton = hostPage.locator('footer button', { hasText: 'Speed' });

      // Start timer, submit answer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Test Answer');

      // Score the answer correct
      const answerCard = hostPage.locator('div').filter({ hasText: 'Test Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Speed bonus button should still be clickable
      await expect(speedBonusButton).toBeEnabled();

      // Toggle it on
      await speedBonusButton.click();

      // Verify it toggled (title should change)
      await expect(speedBonusButton).toHaveAttribute('title', 'Speed bonus enabled');

      await team.context.close();
      await hostContext.close();
    });

    test('speed bonus toggle recalculates scores', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team1', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team2', 'Bob', 'Green');

      // Enable speed bonus first
      const speedBonusButton = hostPage.locator('footer button', { hasText: 'Speed' });
      await speedBonusButton.click();
      await expect(speedBonusButton).toHaveAttribute('title', 'Speed bonus enabled');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Both teams submit (Team1 first)
      await submitAnswerHelper(team1.page, 'Answer1');
      await submitAnswerHelper(team2.page, 'Answer2');

      // Score both correct
      const answerCard1 = hostPage.locator('div').filter({ hasText: 'Answer1' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard1.getByRole('button', { name: 'Mark correct' }).click();

      const answerCard2 = hostPage.locator('div').filter({ hasText: 'Answer2' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await answerCard2.getByRole('button', { name: 'Mark correct' }).click();

      // Team1 should have speed bonus points (scored first)
      // Default: 2 teams eligible, 10 first place points → 1st: 10, 2nd: 5
      // Total: Team1 = 50 + 10 = 60, Team2 = 50 + 5 = 55
      await expect(answerCard1.locator('.text-3xl.font-bold')).toHaveText('60');
      await expect(answerCard2.locator('.text-3xl.font-bold')).toHaveText('55');

      // Toggle speed bonus off
      await speedBonusButton.click();
      await expect(speedBonusButton).toHaveAttribute('title', 'Speed bonus disabled');

      // Speed bonus points should be removed: both teams back to 50
      await expect(answerCard1.locator('.text-3xl.font-bold')).toHaveText('50');
      await expect(answerCard2.locator('.text-3xl.font-bold')).toHaveText('50');

      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });

    test('question type remains locked after answers', async ({ browser }) => {
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });

      // Start timer, submit answer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Test Answer');

      // Question type dropdown should be disabled
      await expect(typeDropdown).toBeDisabled();

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
