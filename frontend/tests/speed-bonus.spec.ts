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

test.describe('Speed Bonus', () => {
  test.describe('Settings', () => {
    test('speed bonus settings appear in settings modal', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Open settings modal
      await page.getByRole('button', { name: 'Open settings' }).click();
      await expect(page.getByText('Game Settings')).toBeVisible();

      // Verify speed bonus section exists
      await expect(page.getByText('Speed Bonus', { exact: true })).toBeVisible();
      await expect(page.getByText('Enable Speed Bonus')).toBeVisible();
      await expect(page.getByText('Teams Eligible')).toBeVisible();
      await expect(page.getByText('First Place Points')).toBeVisible();
    });

    test('speed bonus distribution preview updates', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Open settings modal
      await page.getByRole('button', { name: 'Open settings' }).click();

      // Enable speed bonus
      const speedBonusSection = page.getByText('Speed Bonus', { exact: true }).locator('..');
      const enableToggle = speedBonusSection.locator('button').first();
      await enableToggle.click();

      // Should show distribution preview
      await expect(page.getByText(/Distribution:/)).toBeVisible();
      // Default: 2 teams, 10 points -> 1st: 10, 2nd: 5
      await expect(page.getByText(/1st: 10/)).toBeVisible();
      await expect(page.getByText(/2nd: 5/)).toBeVisible();

      // Change to 3 teams, 12 points
      const teamsInput = speedBonusSection.locator('input[type="number"]').first();
      await teamsInput.fill('3');
      await teamsInput.blur();
      const pointsInput = speedBonusSection.locator('input[type="number"]').nth(1);
      await pointsInput.fill('12');
      await pointsInput.blur();

      // Distribution should update: 1st: 12, 2nd: 8, 3rd: 4
      await expect(page.getByText(/1st: 12/)).toBeVisible();
      await expect(page.getByText(/2nd: 8/)).toBeVisible();
      await expect(page.getByText(/3rd: 4/)).toBeVisible();
    });

    test('per-question speed bonus toggle appears in footer', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Find speed bonus toggle in footer
      const footer = page.locator('footer');
      const speedToggle = footer.getByRole('button', { name: /Speed/i });
      await expect(speedToggle).toBeVisible();
    });

    test('per-question speed toggle can be toggled', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      const footer = page.locator('footer');
      const speedToggle = footer.getByRole('button', { name: /Speed/i });

      // Initially should be in "off" state (gray background)
      await expect(speedToggle).toHaveClass(/bg-gray-100/);

      // Click to enable
      await speedToggle.click();

      // Should now be in "on" state (yellow background)
      await expect(speedToggle).toHaveClass(/bg-yellow-100/);

      // Click again to disable
      await speedToggle.click();

      // Should be back to "off" state
      await expect(speedToggle).toHaveClass(/bg-gray-100/);
    });
  });

  test.describe('Speed Bonus Scoring', () => {
    test('speed bonus badge appears on correct answers', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Enable speed bonus for this question
      const footer = hostPage.locator('footer');
      await footer.getByRole('button', { name: /Speed/i }).click();

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Both teams submit answers in order
      await submitAnswerHelper(team1.page, 'Speed Answer');
      await submitAnswerHelper(team2.page, 'Speed Answer');

      // Wait for answer cards to appear
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(2);

      // Mark first answer correct
      await answerCards.first().getByRole('button', { name: 'Mark correct' }).click();

      // First team (first to answer correctly) should have speed bonus badge
      // The badge shows "+X" with a lightning icon
      const firstTeamCard = answerCards.first();
      await expect(firstTeamCard.getByText(/\+10/)).toBeVisible();

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });

    test('speed bonus distributed based on submission order', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Open settings and enable speed bonus with 3 teams, 12 points
      await hostPage.getByRole('button', { name: 'Open settings' }).click();
      await expect(hostPage.getByText('Game Settings')).toBeVisible();

      const speedBonusSection = hostPage.getByText('Speed Bonus', { exact: true }).locator('..');
      await speedBonusSection.locator('button').first().click(); // Enable toggle

      const teamsInput = speedBonusSection.locator('input[type="number"]').first();
      await teamsInput.fill('3');
      await teamsInput.blur();
      const pointsInput = speedBonusSection.locator('input[type="number"]').nth(1);
      await pointsInput.fill('12');
      await pointsInput.blur();

      await hostPage.getByRole('button', { name: 'Close settings' }).click();

      // Join three teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');
      const team3 = await joinTeamHelper(browser, gameCode, 'Team Gamma', 'Charlie', 'Green');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Teams submit in order
      await submitAnswerHelper(team1.page, 'Same Answer');
      await submitAnswerHelper(team2.page, 'Same Answer');
      await submitAnswerHelper(team3.page, 'Same Answer');

      // Wait for answer cards
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(3);

      // Mark first answer correct (auto-scores all identical answers)
      await answerCards.first().getByRole('button', { name: 'Mark correct' }).click();

      // Verify speed bonuses:
      // 1st place (Team Alpha): 12 points -> total 62 (50 question + 12 speed)
      // 2nd place (Team Beta): 8 points -> total 58 (50 question + 8 speed)
      // 3rd place (Team Gamma): 4 points -> total 54 (50 question + 4 speed)
      await expect(answerCards.nth(0).locator('.text-3xl.font-bold')).toHaveText('62');
      await expect(answerCards.nth(1).locator('.text-3xl.font-bold')).toHaveText('58');
      await expect(answerCards.nth(2).locator('.text-3xl.font-bold')).toHaveText('54');

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await team3.context.close();
      await hostContext.close();
    });

    test('speed bonus only awarded to correct answers', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Enable speed bonus
      const footer = hostPage.locator('footer');
      await footer.getByRole('button', { name: /Speed/i }).click();

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Teams submit different answers
      await submitAnswerHelper(team1.page, 'Wrong Answer');
      await submitAnswerHelper(team2.page, 'Correct Answer');

      // Wait for answer cards
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(2);

      // Find Team Beta's card and mark it correct
      const betaCard = mainContent.locator('div').filter({ hasText: 'Team Beta' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await betaCard.getByRole('button', { name: 'Mark correct' }).click();

      // Team Beta (only correct answer) should get first place speed bonus (10 points)
      // Total: 50 question + 10 speed = 60
      await expect(betaCard.locator('.text-3xl.font-bold')).toHaveText('60');

      // Team Alpha (incorrect) should have 0 points and no speed bonus badge
      const alphaCard = mainContent.locator('div').filter({ hasText: 'Team Alpha' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
      await expect(alphaCard.locator('.text-3xl.font-bold')).toHaveText('0');

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });

    test('speed bonus recalculates when score changes', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Enable speed bonus
      const footer = hostPage.locator('footer');
      await footer.getByRole('button', { name: /Speed/i }).click();

      // Join two teams
      const team1 = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Teams submit same answer
      await submitAnswerHelper(team1.page, 'Same Answer');
      await submitAnswerHelper(team2.page, 'Same Answer');

      // Wait for answer cards
      const mainContent = hostPage.locator('main');
      const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
      await expect(answerCards).toHaveCount(2);

      // Mark first answer correct
      await answerCards.first().getByRole('button', { name: 'Mark correct' }).click();

      // Both should be auto-scored correct
      // 1st: 50 + 10 = 60, 2nd: 50 + 5 = 55
      await expect(answerCards.nth(0).locator('.text-3xl.font-bold')).toHaveText('60');
      await expect(answerCards.nth(1).locator('.text-3xl.font-bold')).toHaveText('55');

      // Now mark first answer incorrect
      await answerCards.first().getByRole('button', { name: 'Mark incorrect' }).click();

      // Team Alpha now has 0, Team Beta should now be "first" with 50 + 10 = 60
      await expect(answerCards.nth(0).locator('.text-3xl.font-bold')).toHaveText('0');
      await expect(answerCards.nth(1).locator('.text-3xl.font-bold')).toHaveText('0');

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });
  });

  test.describe('Speed Bonus Display', () => {
    test('scoreboard shows speed bonus in breakdown on hover', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Enable speed bonus
      const footer = hostPage.locator('footer');
      await footer.getByRole('button', { name: /Speed/i }).click();

      // Join a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer and submit
      await hostPage.getByRole('button', { name: 'Start timer' }).click();
      await submitAnswerHelper(team.page, 'Test Answer');

      // Mark correct
      const mainContent = hostPage.locator('main');
      const answerCard = mainContent.locator('div[class*="rounded-4xl"]').first();
      await answerCard.getByRole('button', { name: 'Mark correct' }).click();

      // Hover over team in scoreboard to see breakdown
      const scoreboard = hostPage.locator('div').filter({ hasText: 'Test Team' }).locator('xpath=ancestor::div[contains(@class, "space-y-3")]//div').filter({ hasText: 'Test Team' }).first();
      await scoreboard.hover();

      // Should show Speed in breakdown
      await expect(hostPage.getByText(/Speed: 10/)).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });
});
