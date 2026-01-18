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

test.describe('Question Types', () => {
  test.describe('3.1 Standard Questions', () => {
    test('standard question displays text input when timer is running', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Initially, timer is not running - should see "Submissions are not yet open"
      await expect(team.page.getByText('Submissions are not yet open')).toBeVisible();

      // Start timer on host
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Now team should see the textarea for answer input
      await expect(team.page.locator('textarea')).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('team can submit text answer', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer on host
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team enters answer
      await team.page.locator('textarea').fill('My Answer');

      // Click submit
      await team.page.getByRole('button', { name: 'Submit Answer' }).click();

      // Verify "Submissions closed" message with submitted answer shown
      await expect(team.page.getByText('Submissions closed.')).toBeVisible();
      await expect(team.page.getByText('My Answer')).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });

  test.describe('3.2 Multiple Choice Questions', () => {
    test('host can switch to multiple choice', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Find the question type dropdown and change to Multiple Choice
      const typeDropdown = page.locator('select').filter({ hasText: /Standard/i });
      await typeDropdown.selectOption('multipleChoice');

      // Verify the dropdown now shows Multiple Choice
      await expect(typeDropdown).toHaveValue('multipleChoice');
    });

    test('multiple choice displays option buttons for team', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Change to multiple choice
      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
      await typeDropdown.selectOption('multipleChoice');

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer on host
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team should see option buttons (A, B, C, D by default)
      await expect(team.page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
      await expect(team.page.getByRole('button', { name: 'B', exact: true })).toBeVisible();
      await expect(team.page.getByRole('button', { name: 'C', exact: true })).toBeVisible();
      await expect(team.page.getByRole('button', { name: 'D', exact: true })).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('team can select and submit MC answer', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Change to multiple choice
      const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
      await typeDropdown.selectOption('multipleChoice');

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer on host
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team selects option B
      await team.page.getByRole('button', { name: 'B', exact: true }).click();

      // Team clicks submit
      await team.page.getByRole('button', { name: 'Submit Answer' }).click();

      // Verify submission was recorded
      await expect(team.page.getByText('Submissions closed.')).toBeVisible();
      await expect(team.page.getByText('B', { exact: true })).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });
});
