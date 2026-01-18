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

test.describe('Scoring', () => {
  test.describe('5.1 Basic Scoring', () => {
    test('host can mark answer correct', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits answer
      await submitAnswerHelper(team.page, 'Correct Answer');

      // Wait for answer card to appear (find it in the main area, not scoreboard)
      // The answer card contains the answer text
      await expect(hostPage.getByText('Correct Answer')).toBeVisible();

      // Find the answer card containing this answer
      const answerCard = hostPage.locator('div').filter({ hasText: 'Correct Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();

      // Click checkmark to mark correct
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // The score should now show the question points (default 10)
      const scoreDisplay = answerCard.locator('.text-3xl.font-bold');
      await expect(scoreDisplay).toHaveText('50');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('host can mark answer incorrect', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits answer
      await submitAnswerHelper(team.page, 'Wrong Answer');

      // Wait for answer card to appear
      await expect(hostPage.getByText('Wrong Answer')).toBeVisible();

      // Find the answer card
      const answerCard = hostPage.locator('div').filter({ hasText: 'Wrong Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();

      // Answer starts as unmarked (0 points) - the Mark correct button should be visible
      await expect(answerCard.getByRole('button', { name: 'Mark correct' })).toBeVisible();

      // The score should be 0
      const scoreDisplay = answerCard.locator('.text-3xl.font-bold');
      await expect(scoreDisplay).toHaveText('0');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('correct/incorrect is toggleable', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits answer
      await submitAnswerHelper(team.page, 'Toggle Answer');

      // Wait for answer card
      await expect(hostPage.getByText('Toggle Answer')).toBeVisible();
      const answerCard = hostPage.locator('div').filter({ hasText: 'Toggle Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      const scoreDisplay = answerCard.locator('.text-3xl.font-bold');

      // Initially 0
      await expect(scoreDisplay).toHaveText('0');

      // Mark correct
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();
      await expect(scoreDisplay).toHaveText('50');

      // Toggle back to incorrect
      await answerCard.getByRole('button', { name: 'Mark incorrect' }).click();
      await expect(scoreDisplay).toHaveText('0');

      // Toggle back to correct
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();
      await expect(scoreDisplay).toHaveText('50');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });

  test.describe('5.2 Bonus Points', () => {
    test('host can add bonus points', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits answer
      await submitAnswerHelper(team.page, 'Bonus Answer');

      // Wait for answer card
      await expect(hostPage.getByText('Bonus Answer')).toBeVisible();
      const answerCard = hostPage.locator('div').filter({ hasText: 'Bonus Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      const scoreDisplay = answerCard.locator('.text-3xl.font-bold');

      // Initially 0
      await expect(scoreDisplay).toHaveText('0');

      // Add bonus points (default increment is 5)
      await answerCard.getByRole('button', { name: 'Add bonus points' }).click();
      await expect(scoreDisplay).toHaveText('5');

      // Add another bonus
      await answerCard.getByRole('button', { name: 'Add bonus points' }).click();
      await expect(scoreDisplay).toHaveText('10');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('host can subtract bonus points', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team submits answer
      await submitAnswerHelper(team.page, 'Subtract Answer');

      // Wait for answer card
      await expect(hostPage.getByText('Subtract Answer')).toBeVisible();
      const answerCard = hostPage.locator('div').filter({ hasText: 'Subtract Answer' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      const scoreDisplay = answerCard.locator('.text-3xl.font-bold');

      // Add some bonus first
      await answerCard.getByRole('button', { name: 'Add bonus points' }).click();
      await answerCard.getByRole('button', { name: 'Add bonus points' }).click();
      await expect(scoreDisplay).toHaveText('10');

      // Subtract bonus (default decrement is 5)
      await answerCard.getByRole('button', { name: 'Remove bonus points' }).click();
      await expect(scoreDisplay).toHaveText('5');

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });

  test.describe('5.3 Auto-Scoring of Identical Answers', () => {
    test('auto-score identical text answers (host view)', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Both teams submit the exact same answer
      await submitAnswerHelper(team1.page, 'Same Answer Alpha');
      await submitAnswerHelper(team2.page, 'Same Answer Alpha');

      // Wait for the answer text to appear (answers are the same, so look for one)
      await expect(hostPage.getByText('Same Answer Alpha').first()).toBeVisible();

      // The answers are grouped - find answer cards with Team Alpha and Team Beta
      // Use a more specific locator to find the answer cards in the main content area
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');

      // Wait for 2 answer cards
      await expect(answerCards).toHaveCount(2);

      // Get the first answer card (Team Alpha) and mark it correct
      const firstAnswerCard = answerCards.first();
      await firstAnswerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Verify both cards now show 10 points (auto-scoring)
      await expect(firstAnswerCard.locator('.text-3xl.font-bold')).toHaveText('50');
      await expect(answerCards.nth(1).locator('.text-3xl.font-bold')).toHaveText('50');

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });

    test('auto-score identical text answers (team view)', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Both teams submit the exact same answer
      await submitAnswerHelper(team1.page, 'Same Answer Beta');
      await submitAnswerHelper(team2.page, 'Same Answer Beta');

      // Wait for answer to appear on host
      await expect(hostPage.getByText('Same Answer Beta').first()).toBeVisible();

      // Find answer cards in main content
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(2);

      // Mark first answer as correct
      await answerCards.first().getByRole('button', { name: 'Mark correct' }).click();

      // Verify Team Beta's score updates in their game view
      // The team view shows "Score: X" in the header
      await expect(team2.page.getByText('Score: 50')).toBeVisible();

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });

    test('auto-score identical MC answers', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Switch to multiple choice
      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
      await typeDropdown.selectOption('multipleChoice');

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Both teams select and submit the same option (B)
      await team1.page.getByRole('button', { name: 'B', exact: true }).click();
      await team1.page.getByRole('button', { name: 'Submit Answer' }).click();
      await expect(team1.page.getByText('Submissions closed.')).toBeVisible();

      await team2.page.getByRole('button', { name: 'B', exact: true }).click();
      await team2.page.getByRole('button', { name: 'Submit Answer' }).click();
      await expect(team2.page.getByText('Submissions closed.')).toBeVisible();

      // Wait for answer cards to appear in main content
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(2);

      // Mark first answer as correct
      await answerCards.first().getByRole('button', { name: 'Mark correct' }).click();

      // Both should now show 10 points due to auto-scoring
      await expect(answerCards.first().locator('.text-3xl.font-bold')).toHaveText('50');
      await expect(answerCards.nth(1).locator('.text-3xl.font-bold')).toHaveText('50');

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });

    test('auto-score applies bonus points too', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Both teams submit the exact same answer
      await submitAnswerHelper(team1.page, 'Same Bonus Answer');
      await submitAnswerHelper(team2.page, 'Same Bonus Answer');

      // Wait for answer cards to appear in main content
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(2);

      const firstCard = answerCards.first();
      const secondCard = answerCards.nth(1);

      // Mark first answer as correct
      await firstCard.getByRole('button', { name: 'Mark correct' }).click();

      // Add bonus to first card
      await firstCard.getByRole('button', { name: 'Add bonus points' }).click();

      // First card should have 15 (10 points + 5 bonus)
      await expect(firstCard.locator('.text-3xl.font-bold')).toHaveText('55');

      // Second card should also have 15 (auto-scored with same bonus)
      await expect(secondCard.locator('.text-3xl.font-bold')).toHaveText('55');

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });
  });
});
