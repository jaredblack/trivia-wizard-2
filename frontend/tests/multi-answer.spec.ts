import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { createGame, submitMultiAnswer } from './helpers';

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

test.describe('Multi-Answer Questions', () => {
  test('host can switch to multi-answer question type', async ({ page }) => {
    await page.goto('/host');
    await expect(page.getByText('Server running!')).toBeVisible();
    await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
    await expect(page).toHaveURL('/host/game');

    // Find the question type dropdown and change to multi-answer
    const typeDropdown = page.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Verify the dropdown now shows multiAnswer
    await expect(typeDropdown).toHaveValue('multiAnswer');

    // Verify the "Number of answers" label is visible (unique to multi-answer)
    await expect(page.getByText('Number of answers')).toBeVisible();
  });

  test('team sees multi-answer input fields when timer is running', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Switch to multi-answer
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer on host
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team should see 3 input fields (default numAnswers = 3)
    await expect(team.page.getByPlaceholder('Answer 1')).toBeVisible();
    await expect(team.page.getByPlaceholder('Answer 2')).toBeVisible();
    await expect(team.page.getByPlaceholder('Answer 3')).toBeVisible();

    // Submit button should be visible
    await expect(team.page.getByRole('button', { name: 'Submit Answers' })).toBeVisible();

    // Cleanup
    await team.context.close();
    await hostContext.close();
  });

  test('team can submit multiple answers', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Switch to multi-answer
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team submits 3 answers
    await submitMultiAnswer(team.page, ['cat', 'dog', 'fish']);

    // Team sees confirmation with comma-joined answer text
    await expect(team.page.getByText('Submissions closed.')).toBeVisible();
    await expect(team.page.getByText('cat, dog, fish')).toBeVisible();

    // Host sees the submitted answers as pills in a rounded-4xl answer card
    const mainContent = hostPage.locator('main');
    const answerCard = mainContent.locator('div[class*="rounded-4xl"]').first();
    await expect(answerCard.getByText('cat')).toBeVisible();
    await expect(answerCard.getByText('dog')).toBeVisible();
    await expect(answerCard.getByText('fish')).toBeVisible();

    // Cleanup
    await team.context.close();
    await hostContext.close();
  });

  test('team can submit with some answer slots left blank', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Switch to multi-answer
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team fills only the first input, leaves 2 and 3 empty
    await submitMultiAnswer(team.page, ['cat', '', '']);

    // Team sees confirmation with "cat" in the answer text
    await expect(team.page.getByText('Submissions closed.')).toBeVisible();
    await expect(team.page.getByText('cat')).toBeVisible();

    // Host sees one text pill ("cat") and two "empty" pills (dashed gray)
    const mainContent = hostPage.locator('main');
    const answerCard = mainContent.locator('div[class*="rounded-4xl"]').first();
    await expect(answerCard.getByText('cat')).toBeVisible();

    // Empty pills show "empty" text with dashed border and are not clickable buttons
    const emptyPills = answerCard.locator('span').filter({ hasText: /^empty$/ });
    await expect(emptyPills).toHaveCount(2);

    // Cleanup
    await team.context.close();
    await hostContext.close();
  });

  test('team can submit with a gap in the middle (skipped field)', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Switch to multi-answer
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team fills only input 1 and 3, never interacting with input 2 at all
    await team.page.getByPlaceholder('Answer 1').fill('cat');
    await team.page.getByPlaceholder('Answer 3').fill('fish');
    await team.page.getByRole('button', { name: 'Submit Answers' }).click();

    // Team sees confirmation
    await expect(team.page.getByText('Submissions closed.')).toBeVisible();
    await expect(team.page.getByText('cat')).toBeVisible();
    await expect(team.page.getByText('fish')).toBeVisible();

    // Host sees two text pills and one "empty" pill for the skipped middle field
    const mainContent = hostPage.locator('main');
    const answerCard = mainContent.locator('div[class*="rounded-4xl"]').first();
    await expect(answerCard.getByText('cat')).toBeVisible();
    await expect(answerCard.getByText('fish')).toBeVisible();

    const emptyPills = answerCard.locator('span').filter({ hasText: /^empty$/ });
    await expect(emptyPills).toHaveCount(1);

    // Cleanup
    await team.context.close();
    await hostContext.close();
  });

  test('host can toggle sub-answer pills to update score', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Switch to multi-answer
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Join as a team
    const team = await joinTeamHelper(browser, gameCode, 'Test Team', 'Alice', 'Orange');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team submits 3 answers
    await submitMultiAnswer(team.page, ['cat', 'dog', 'fish']);

    // Wait for answer card to appear on host
    const mainContent = hostPage.locator('main');
    const answerCard = mainContent.locator('div[class*="rounded-4xl"]').first();
    await expect(answerCard.getByText('cat')).toBeVisible();

    const scoreDisplay = answerCard.locator('.text-3xl.font-bold');

    // Initially score is 0
    await expect(scoreDisplay).toHaveText('0');

    // Click first pill ("cat") to mark it correct -> score = floor(50/3) = 16
    await answerCard.getByRole('button', { name: 'cat' }).click();
    await expect(scoreDisplay).toHaveText('16');

    // Click second pill ("dog") correct -> score = 32
    await answerCard.getByRole('button', { name: 'dog' }).click();
    await expect(scoreDisplay).toHaveText('32');

    // Toggle first pill ("cat") back to incorrect -> score = 16
    await answerCard.getByRole('button', { name: 'cat' }).click();
    await expect(scoreDisplay).toHaveText('16');

    // Cleanup
    await team.context.close();
    await hostContext.close();
  });

  test('toggling correctness re-grades across teams', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const gameCode = await createGame(hostPage);

    // Switch to multi-answer
    const typeDropdown = hostPage.locator('select').filter({ hasText: /Standard/i });
    await typeDropdown.selectOption('multiAnswer');

    // Join two teams
    const teamA = await joinTeamHelper(browser, gameCode, 'Team Alpha', 'Alice', 'Orange');
    const teamB = await joinTeamHelper(browser, gameCode, 'Team Beta', 'Bob', 'Blue');

    // Start timer
    await hostPage.getByRole('button', { name: 'Start timer' }).click();

    // Team A submits ["cat", "dog", "fish"]
    await submitMultiAnswer(teamA.page, ['cat', 'dog', 'fish']);

    // Team B submits ["cat", "bird", "fish"]
    await submitMultiAnswer(teamB.page, ['cat', 'bird', 'fish']);

    // Wait for both answer cards to appear
    const mainContent = hostPage.locator('main');
    const answerCards = mainContent.locator('div[class*="rounded-4xl"]');
    await expect(answerCards).toHaveCount(2);

    // Find Team Alpha's answer card and click "cat" pill
    const teamACard = hostPage.locator('div').filter({ hasText: 'Team Alpha' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
    await teamACard.getByRole('button', { name: 'cat' }).click();

    // Both teams should now show "cat" as correct (green pill) and score 16 each
    const teamAScore = teamACard.locator('.text-3xl.font-bold');
    await expect(teamAScore).toHaveText('16');

    const teamBCard = hostPage.locator('div').filter({ hasText: 'Team Beta' }).locator('xpath=ancestor-or-self::div[contains(@class, "rounded-4xl")]').first();
    const teamBScore = teamBCard.locator('.text-3xl.font-bold');
    await expect(teamBScore).toHaveText('16');

    // Cleanup
    await teamA.context.close();
    await teamB.context.close();
    await hostContext.close();
  });
});
