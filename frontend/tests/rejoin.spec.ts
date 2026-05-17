import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { createGame } from './helpers';

async function joinTeamHelper(
  browser: Browser,
  gameCode: string,
  teamName: string,
  memberName: string,
  colorName: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/join');

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

test.describe('Auto-rejoin after reload', () => {
  test('team auto-rejoins after page reload mid-game', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    const team = await joinTeamHelper(browser, gameCode, 'Alpha', 'Alice', 'Orange');
    await expect(team.page.getByText('Question 1')).toBeVisible();

    // Reload the team page; localStorage in the same context persists.
    await team.page.reload();

    // Auto-rejoin lands us back at the game view, no wizard.
    await expect(team.page.getByText('Question 1')).toBeVisible();
    await expect(team.page.getByPlaceholder('Enter game code')).not.toBeVisible();

    await team.context.close();
    await hostContext.close();
  });

  test('host auto-rejoins after page reload mid-game', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    await expect(hostPage).toHaveURL('/host/game');
    await expect(hostPage.getByText(`Game Code: ${gameCode}`)).toBeVisible();

    await hostPage.reload();

    await expect(hostPage).toHaveURL('/host/game');
    await expect(hostPage.getByText(`Game Code: ${gameCode}`)).toBeVisible();

    await hostContext.close();
  });

  test('team with stale rejoin data falls back to join wizard', async ({ browser }) => {
    const teamContext = await browser.newContext();
    const teamPage = await teamContext.newPage();
    await teamPage.goto('/join');

    // Seed bogus rejoin data; the game does not exist on the server.
    await teamPage.evaluate(() => {
      localStorage.setItem(
        'trivia_team_rejoin',
        JSON.stringify({
          gameCode: 'ZZZZ',
          teamName: 'Ghost',
          savedAt: Date.now(),
        }),
      );
    });

    await teamPage.reload();

    // After the failed rejoin attempt, the join form is back.
    await expect(teamPage.getByPlaceholder('Enter game code')).toBeVisible({
      timeout: 10_000,
    });

    // And the stale entry has been cleared.
    const stored = await teamPage.evaluate(() =>
      localStorage.getItem('trivia_team_rejoin'),
    );
    expect(stored).toBeNull();

    await teamContext.close();
  });
});
