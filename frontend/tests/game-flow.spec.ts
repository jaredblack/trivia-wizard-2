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

test.describe('Full Game Flow', () => {
  test('complete game with 2 teams, 3 questions', async ({ browser }) => {
    // ===== SETUP =====
    // Create a game as host
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Join two teams with different colors
    const team1 = await joinTeamHelper(browser, gameCode, 'The Experts', 'Alice', 'Orange');
    const team2 = await joinTeamHelper(browser, gameCode, 'Quiz Masters', 'Bob', 'Blue');

    // Verify both teams appear on host scoreboard
    await expect(hostPage.getByText('The Experts')).toBeVisible();
    await expect(hostPage.getByText('Quiz Masters')).toBeVisible();

    // Find the main content area for answer cards
    const mainContent = hostPage.locator('main');

    // ===== QUESTION 1: Standard Question =====
    // Both teams submit, one correct
    // Question number is displayed in the header within a flex-col container
    const questionNumberElement = hostPage.locator('header').locator('.text-4xl.font-bold').filter({ hasText: /^\d+$/ });
    await expect(questionNumberElement).toHaveText('1');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team 1 submits correct answer
    await team1.page.locator('textarea').fill('Correct Answer Q1');
    await team1.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(team1.page.getByText('Submissions closed.')).toBeVisible();

    // Team 2 submits wrong answer
    await team2.page.locator('textarea').fill('Wrong Answer Q1');
    await team2.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(team2.page.getByText('Submissions closed.')).toBeVisible();

    // Wait for answers on host
    await expect(hostPage.getByText('Correct Answer Q1')).toBeVisible();
    await expect(hostPage.getByText('Wrong Answer Q1')).toBeVisible();

    // Mark Team 1's answer correct
    const q1CorrectCard = hostPage.locator('div').filter({ hasText: 'Correct Answer Q1' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
    await q1CorrectCard.getByRole('button', { name: 'Mark correct' }).click();
    await expect(q1CorrectCard.locator('.text-3xl.font-bold')).toHaveText('50');

    // ===== QUESTION 2: Multiple Choice =====
    // Navigate to question 2
    await hostPage.getByRole('button', { name: 'Next question' }).click();
    await expect(questionNumberElement).toHaveText('2');

    // Change to multiple choice
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multipleChoice');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Both teams select and submit the same option (C) - testing auto-scoring
    await team1.page.getByRole('button', { name: 'C', exact: true }).click();
    await team1.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(team1.page.getByText('Submissions closed.')).toBeVisible();

    await team2.page.getByRole('button', { name: 'C', exact: true }).click();
    await team2.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(team2.page.getByText('Submissions closed.')).toBeVisible();

    // Wait for answer cards
    const q2AnswerCards = mainContent.locator('div[class*="rounded-4xl"]');
    await expect(q2AnswerCards).toHaveCount(2);

    // Mark one answer correct - the other should auto-score
    await q2AnswerCards.first().getByRole('button', { name: 'Mark correct' }).click();

    // Both should now have 50 points
    await expect(q2AnswerCards.first().locator('.text-3xl.font-bold')).toHaveText('50');
    await expect(q2AnswerCards.nth(1).locator('.text-3xl.font-bold')).toHaveText('50');

    // ===== QUESTION 3: Standard with Bonus Points =====
    // Navigate to question 3
    await hostPage.getByRole('button', { name: 'Next question' }).click();
    await expect(questionNumberElement).toHaveText('3');

    // Change back to standard
    await hostPage.locator('select').first().selectOption('standard');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Both teams submit
    await team1.page.locator('textarea').fill('Answer Q3 Team1');
    await team1.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(team1.page.getByText('Submissions closed.')).toBeVisible();

    await team2.page.locator('textarea').fill('Answer Q3 Team2');
    await team2.page.getByRole('button', { name: 'Submit Answer' }).click();
    await expect(team2.page.getByText('Submissions closed.')).toBeVisible();

    // Wait for answers
    await expect(hostPage.getByText('Answer Q3 Team1')).toBeVisible();

    // Mark Team 1 correct and add bonus
    const q3Team1Card = hostPage.locator('div').filter({ hasText: 'Answer Q3 Team1' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
    await q3Team1Card.getByRole('button', { name: 'Mark correct' }).click();
    await q3Team1Card.getByRole('button', { name: 'Add bonus points' }).click();
    await expect(q3Team1Card.locator('.text-3xl.font-bold')).toHaveText('55');

    // Mark Team 2 correct (no bonus)
    const q3Team2Card = hostPage.locator('div').filter({ hasText: 'Answer Q3 Team2' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
    await q3Team2Card.getByRole('button', { name: 'Mark correct' }).click();
    await expect(q3Team2Card.locator('.text-3xl.font-bold')).toHaveText('50');

    // ===== VERIFY FINAL SCORES =====
    // Team 1: Q1(50) + Q2(50) + Q3(55) = 155
    // Team 2: Q1(0) + Q2(50) + Q3(50) = 100

    // Check team scores on their respective pages
    await expect(team1.page.getByText('Score: 155')).toBeVisible();
    await expect(team2.page.getByText('Score: 100')).toBeVisible();

    // ===== CLEANUP =====
    await team1.context.close();
    await team2.context.close();
    await hostContext.close();
  });
});
