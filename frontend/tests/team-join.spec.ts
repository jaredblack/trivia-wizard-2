import { test, expect, Browser } from '@playwright/test';
import { createGame } from './helpers';

test.describe('Team Join Flow', () => {
  test.describe('2.1 Basic Join', () => {
    test('team can complete full join flow', async ({ browser }) => {
      // Create a game as host first
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Now join as a team
      const teamContext = await browser.newContext();
      const teamPage = await teamContext.newPage();
      await teamPage.goto('/');

      // Click "Join Game" button on landing page
      await teamPage.getByRole('link', { name: 'Join Game' }).click();

      // Should be on the join page
      await expect(teamPage).toHaveURL('/join');

      // Wait for connection
      await expect(teamPage.getByPlaceholder('Enter game code')).toBeVisible();

      // Enter game code
      await teamPage.getByPlaceholder('Enter game code').fill(gameCode);

      // Enter team name
      await teamPage.getByPlaceholder('Enter team name').fill('Test Team');

      // Click Next
      await teamPage.getByRole('button', { name: 'Next' }).click();

      // Wait for members step
      await expect(teamPage.getByText("Who's on your team?")).toBeVisible();

      // Enter first team member name
      await teamPage.getByPlaceholder('Team member name').first().fill('Alice');

      // Click Next
      await teamPage.getByRole('button', { name: 'Next' }).click();

      // Wait for color step
      await expect(teamPage.getByText('Choose your team color:')).toBeVisible();

      // Select Orange color
      await teamPage.getByRole('button', { name: 'Select Orange' }).click();

      // Click the "Choose Orange" button to join
      await teamPage.getByRole('button', { name: /Choose Orange/i }).click();

      // Verify we're in the game view - should see Question 1 (team view shows "Question X")
      await expect(teamPage.getByText('Question 1')).toBeVisible();

      // Verify team name is displayed
      await expect(teamPage.getByText('Test Team')).toBeVisible();

      // Cleanup
      await hostContext.close();
      await teamContext.close();
    });

    test('invalid game code shows error', async ({ page }) => {
      await page.goto('/join');

      // Wait for connection
      await expect(page.getByPlaceholder('Enter game code')).toBeVisible();

      // Enter invalid game code
      await page.getByPlaceholder('Enter game code').fill('XXXX');

      // Enter team name
      await page.getByPlaceholder('Enter team name').fill('Test Team');

      // Click Next
      await page.getByRole('button', { name: 'Next' }).click();

      // Should see an error message (Toast component)
      await expect(page.getByText(/game.*not found|invalid.*code|does.*not.*exist/i)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('2.2 Multiple Teams', () => {
    test('multiple teams can join same game', async ({ browser }) => {
      // Create a game as host
      const hostContext = await browser.newContext();
      const hostPage = await hostContext.newPage();
      const gameCode = await createGame(hostPage);

      // Helper to join a team
      async function joinTeam(browser: Browser, teamName: string, memberName: string, colorName: string) {
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

      // Join two teams with different colors
      const team1 = await joinTeam(browser, 'Team Alpha', 'Alice', 'Orange');
      const team2 = await joinTeam(browser, 'Team Beta', 'Bob', 'Blue');

      // Verify both teams are visible on the host scoreboard
      await expect(hostPage.getByText('Team Alpha')).toBeVisible();
      await expect(hostPage.getByText('Team Beta')).toBeVisible();

      // Cleanup
      await team1.context.close();
      await team2.context.close();
      await hostContext.close();
    });
  });
});
