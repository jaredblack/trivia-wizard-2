import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { createGame, startTimer, pauseTimer, resetTimer } from './helpers';

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
 * Helper to connect a watcher to a game and return the context and page.
 */
async function connectWatcher(
  browser: Browser,
  gameCode: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/watch');

  await page.getByLabel('Game Code').fill(gameCode);
  await page.getByRole('button', { name: 'Watch Game' }).click();

  // Wait for the scoreboard to appear
  await expect(page.getByText(`Scoreboard: ${gameCode}`)).toBeVisible();
  return { context, page };
}

test.describe('Watcher Timer Display', () => {
  test('watcher sees timer update when host starts, pauses, and resets timer', async ({ browser }) => {
    // Create a game as host
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Join a team so the scoreboard has content
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Connect a watcher
    const watcher = await connectWatcher(browser, gameCode);

    // Watcher should see the timer display with initial value (0:30 default)
    const watcherTimer = watcher.page.locator('.font-mono.font-bold');
    await expect(watcherTimer).toBeVisible();
    const initialTime = await watcherTimer.textContent();
    expect(initialTime).toBe('0:30');

    // Timer should be gray (not running)
    await expect(watcherTimer).toHaveClass(/text-gray-400/);

    // Host starts the timer
    await startTimer(hostPage);

    // Watcher timer should turn green (running)
    await expect(watcherTimer).toHaveClass(/text-green-600/);

    // Wait for a couple ticks and verify the timer is counting down
    await watcher.page.waitForTimeout(2500);
    const tickedTime = await watcherTimer.textContent();
    expect(tickedTime).not.toBe(initialTime);

    // Host pauses the timer
    await pauseTimer(hostPage);

    // Watcher timer should turn gray (paused)
    await expect(watcherTimer).toHaveClass(/text-gray-400/);

    // Record the paused time
    const pausedTime = await watcherTimer.textContent();

    // Wait a moment and verify the timer is NOT counting down while paused
    await watcher.page.waitForTimeout(1500);
    await expect(watcherTimer).toHaveText(pausedTime!);

    // Host resets the timer
    await resetTimer(hostPage);

    // Watcher timer should show the initial value again
    await expect(watcherTimer).toHaveText('0:30');

    // Cleanup
    await watcher.context.close();
    await team.context.close();
    await hostContext.close();
  });
});
