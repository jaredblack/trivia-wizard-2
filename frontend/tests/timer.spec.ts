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

test.describe('Timer Functionality', () => {
  test.describe('4.1 Basic Timer Controls', () => {
    test('timer starts when host clicks play', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Verify timer is not running initially (team sees "Submissions are not yet open")
      await expect(team.page.getByText('Submissions are not yet open')).toBeVisible();

      // Host clicks play/start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team should now see the textarea (submissions open)
      await expect(team.page.locator('textarea')).toBeVisible();

      // The timer on the team page should be counting down (visible)
      // We can verify by checking the timer display exists
      const teamTimerDisplay = team.page.locator('text=/\\d+:\\d+/');
      await expect(teamTimerDisplay).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('timer pauses when host clicks pause', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Verify team sees textarea (submissions open)
      await expect(team.page.locator('textarea')).toBeVisible();

      // Host pauses timer
      await hostPage.getByRole('button', { name: 'Pause timer' }).click();

      // When timer is paused with time remaining and no answer submitted,
      // team sees "Submissions are not yet open" (submissions close temporarily)
      await expect(team.page.getByText('Submissions are not yet open')).toBeVisible();

      // Textarea should no longer be visible
      await expect(team.page.locator('textarea')).not.toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('timer resets to configured duration', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      await createGame(hostPage);

      // Get initial timer value (default is usually 60 seconds = 1:00)
      const hostTimerDisplay = hostPage.locator('.text-4xl').filter({ hasText: /\d+:\d+/ });
      const initialTime = await hostTimerDisplay.textContent();

      // Start timer
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Wait a moment for timer to count down
      await hostPage.waitForTimeout(1500);

      // Timer should have decreased
      const midTime = await hostTimerDisplay.textContent();
      expect(midTime).not.toBe(initialTime);

      // Pause the timer
      await hostPage.getByRole('button', { name: 'Pause timer' }).click();

      // Reset timer
      await hostPage.getByRole('button', { name: 'Reset timer' }).click();

      // Timer should be back to initial value
      await expect(hostTimerDisplay).toHaveText(initialTime!);

      // Cleanup
      await hostContext.close();
    });
  });

  test.describe('4.2 Timer-Based Submission Restrictions', () => {
    test('team cannot submit before timer starts', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Team should see "Submissions are not yet open"
      await expect(team.page.getByText('Submissions are not yet open')).toBeVisible();

      // Verify no textarea is visible (can't submit)
      await expect(team.page.locator('textarea')).not.toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });

    test('auto-submit on timer expiry', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Set timer to a short duration (3 seconds) for quick test
      // First, update the timer input field
      const timerInput = hostPage.locator('input[type="number"]').filter({ hasText: '' }).first();
      // Find the timer duration input by its position in GameSettings
      const timerLengthInput = hostPage.locator('input').filter({ hasNotText: /.*/ }).nth(2);

      // Actually, let's find it by checking the GameSettings component structure
      // The timer input is in GameSettings footer - let's look for it
      // For now, we'll use a short timer by changing the value via the UI

      // Let's just clear and set the timer to 3 seconds
      await hostPage.getByRole('spinbutton').nth(2).fill('3');

      // Join as a team
      const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

      // Start timer on host
      await hostPage.getByRole('button', { name: 'Start timer' }).click();

      // Team enters answer but doesn't click submit
      await team.page.locator('textarea').fill('Auto-submitted answer');

      // Wait for timer to expire (3 seconds + buffer)
      await team.page.waitForTimeout(4000);

      // Answer should have been auto-submitted
      await expect(team.page.getByText('Submissions closed.')).toBeVisible();
      await expect(team.page.getByText('Auto-submitted answer')).toBeVisible();

      // Cleanup
      await team.context.close();
      await hostContext.close();
    });
  });
});
