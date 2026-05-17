import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import {
  createGame,
  startTimer,
  submitMapAnswer,
  setMapCorrectLocation,
} from './helpers';

/**
 * Map tests rely on VITE_TEST_MODE=true so the Map components render lat/lng
 * inputs instead of the Google Maps widget. Playwright sets this via the
 * webServer env in playwright.config.ts. If running these against an external
 * dev server without VITE_TEST_MODE, the tests will fail to find the labeled
 * inputs.
 */

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

/**
 * Switches the current question to the Map type via the host's type dropdown.
 */
async function switchToMap(hostPage: Page): Promise<void> {
  const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
  await typeDropdown.selectOption('map');
  await expect(typeDropdown).toHaveValue('map');
}

/**
 * Sets the host's map distance thresholds. Targets the labeled inputs in the
 * test-mode config bar (which mirror the real config bar's labels).
 */
async function setMapDistances(
  hostPage: Page,
  fullPointsKm: number,
  onePointKm: number,
): Promise<void> {
  const fullInput = hostPage.getByText('Full pts (km)').locator('xpath=following-sibling::input');
  await fullInput.fill(String(fullPointsKm));
  await fullInput.press('Enter');

  const oneInput = hostPage.getByText('1 pt (km)').locator('xpath=following-sibling::input');
  await oneInput.fill(String(onePointKm));
  await oneInput.press('Enter');
}

/**
 * Reads the question_points-only score (left-most large number) from a team's
 * answer card on the host page. Bonus and speed bonus are excluded by this
 * locator; the score span lives at the top of the card.
 */
function scoreFor(hostPage: Page, teamName: string) {
  const card = hostPage
    .locator(`text=${teamName}`)
    .locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
  return card.locator('.text-3xl').first();
}

test.describe('Map question type', () => {
  test('host can set correct location and team can submit a pin', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);
    await switchToMap(hostPage);
    await setMapCorrectLocation(hostPage, 40.7128, -74.006);

    // Host now shows the correct location in the config bar.
    await expect(hostPage.getByText('40.7128, -74.0060')).toBeVisible();

    const team = await joinTeamHelper(browser, gameCode, 'Alpha', 'Alice', 'Orange');
    await startTimer(hostPage);

    // Team sees the map pin inputs.
    await expect(team.page.getByLabel('Team pin lat')).toBeVisible();
    await submitMapAnswer(team.page, 40.7128, -74.006);

    // Host's answer card for Alpha shows distance 0m and full points (default 50).
    const alphaCard = hostPage
      .locator('text=Alpha')
      .locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
    await expect(alphaCard.getByText('0m away')).toBeVisible();
    await expect(scoreFor(hostPage, 'Alpha')).toHaveText('50');

    await team.context.close();
    await hostContext.close();
  });

  test('scoring tiers reflect distance bands', async ({ browser }) => {
    // base_points (default question_points) = 50.
    // fullPoints=10 km → within 10 km of correct = 50 pts.
    // onePoint=1000 km → exponential decay between full and 1pt distance.
    // Beyond ~one_point_distance * 2 the floor() drives the score to 0.
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);
    await switchToMap(hostPage);
    await setMapDistances(hostPage, 10, 1000);
    await setMapCorrectLocation(hostPage, 0, 0);

    const teamA = await joinTeamHelper(browser, gameCode, 'Alpha', 'Alice', 'Orange');
    const teamB = await joinTeamHelper(browser, gameCode, 'Bravo', 'Bob', 'Blue');
    const teamC = await joinTeamHelper(browser, gameCode, 'Charlie', 'Carol', 'Green');

    await startTimer(hostPage);

    // (0, 0.05) ≈ 5.56 km → within fullPoints=10 → full 50.
    await submitMapAnswer(teamA.page, 0, 0.05);
    // (0, 5) ≈ 555.97 km → between full and onePoint=1000 → floor(50 * (1/50)^0.556) ≈ 5.
    await submitMapAnswer(teamB.page, 0, 5);
    // (0, 50) ≈ 5559 km → beyond onePoint → 0.
    await submitMapAnswer(teamC.page, 0, 50);

    await expect(scoreFor(hostPage, 'Alpha')).toHaveText('50');
    await expect(scoreFor(hostPage, 'Bravo')).toHaveText('5');
    await expect(scoreFor(hostPage, 'Charlie')).toHaveText('0');

    await teamA.context.close();
    await teamB.context.close();
    await teamC.context.close();
    await hostContext.close();
  });

  test('changing onePointDistanceKm re-scores already-submitted answers', async ({ browser }) => {
    // Commit b13e332: 1-pt distance is configurable per Map question. Changing
    // it after submissions must trigger a re-score on the backend.
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);
    await switchToMap(hostPage);
    await setMapDistances(hostPage, 10, 1000);
    await setMapCorrectLocation(hostPage, 0, 0);

    const team = await joinTeamHelper(browser, gameCode, 'Alpha', 'Alice', 'Orange');
    await startTimer(hostPage);

    // (0, 5) ≈ 555.97 km. With onePoint=1000: score ≈ 5.
    await submitMapAnswer(team.page, 0, 5);
    await expect(scoreFor(hostPage, 'Alpha')).toHaveText('5');

    // Widen the 1-pt distance to 10000. Decay is much gentler now.
    // score = 50 * (1/50)^(555.97/10000) ≈ floor(50 * 0.8045) = 40.
    const oneInput = hostPage.getByText('1 pt (km)').locator('xpath=following-sibling::input');
    await oneInput.fill('10000');
    await oneInput.press('Enter');

    await expect(scoreFor(hostPage, 'Alpha')).toHaveText('40');

    await team.context.close();
    await hostContext.close();
  });
});
