import { Page, expect } from '@playwright/test';

/**
 * Creates a game as host and returns the game code.
 * Assumes the page starts at /host with server already running.
 */
export async function createGame(page: Page): Promise<string> {
  await page.goto('/host');

  // Wait for server to be detected as running
  await expect(page.getByText('Server running!')).toBeVisible();

  // Click the "Create Game with random game code" button
  await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();

  // Should navigate to /host/game
  await expect(page).toHaveURL('/host/game');

  // Extract the game code from the page
  const gameCodeElement = page.locator('text=Game Code:').locator('xpath=..');
  const gameCodeText = await gameCodeElement.textContent();
  const gameCode = gameCodeText?.match(/[A-Z]{4}/)?.[0];

  if (!gameCode) {
    throw new Error('Could not extract game code from page');
  }

  return gameCode;
}

/**
 * Creates a game with a specific custom code.
 */
export async function createGameWithCode(page: Page, customCode: string): Promise<string> {
  await page.goto('/host');

  // Wait for server to be detected as running
  await expect(page.getByText('Server running!')).toBeVisible();

  // Enter custom game code
  await page.getByPlaceholder('Game code').fill(customCode);

  // Click the "Create Game" button (not the one with "random game code")
  await page.getByRole('button', { name: 'Create Game' }).filter({ hasNotText: 'random game code' }).click();

  // Should navigate to /host/game
  await expect(page).toHaveURL('/host/game');

  return customCode;
}

/**
 * Joins a game as a team.
 */
export async function joinTeam(
  page: Page,
  gameCode: string,
  teamName: string,
  memberName: string,
  colorName: string
): Promise<void> {
  await page.goto('/');

  // Click "Join Game" button on landing page
  await page.getByRole('button', { name: /Join Game/i }).click();

  // Enter game code
  await page.getByPlaceholder('Enter game code').fill(gameCode);

  // Enter team name
  await page.getByPlaceholder('Enter team name').fill(teamName);

  // Click Next
  await page.getByRole('button', { name: 'Next' }).click();

  // Wait for members step
  await expect(page.getByText("Who's on your team?")).toBeVisible();

  // Enter first team member name
  await page.getByPlaceholder('Team member name').first().fill(memberName);

  // Click Next
  await page.getByRole('button', { name: 'Next' }).click();

  // Wait for color step
  await expect(page.getByText('Choose your team color:')).toBeVisible();

  // Select color by aria-label
  await page.getByRole('button', { name: `Select ${colorName}` }).click();

  // Click the "Choose [color]" button
  await page.getByRole('button', { name: new RegExp(`Choose ${colorName}`, 'i') }).click();

  // Verify we're in the game view
  await expect(page.getByText(`Question 1`)).toBeVisible();
}

/**
 * Submits an answer as a team (for standard questions).
 */
export async function submitAnswer(page: Page, answer: string): Promise<void> {
  // Fill the answer textarea
  await page.locator('textarea').fill(answer);

  // Click submit button
  await page.getByRole('button', { name: 'Submit Answer' }).click();

  // Verify submission was successful
  await expect(page.getByText('Submissions closed.')).toBeVisible();
}

/**
 * Starts the timer as host.
 */
export async function startTimer(hostPage: Page): Promise<void> {
  await hostPage.getByRole('button', { name: /play|start/i }).click();
}

/**
 * Pauses the timer as host.
 */
export async function pauseTimer(hostPage: Page): Promise<void> {
  await hostPage.getByRole('button', { name: /pause/i }).click();
}

/**
 * Resets the timer as host.
 */
export async function resetTimer(hostPage: Page): Promise<void> {
  await hostPage.getByRole('button', { name: /reset/i }).click();
}

/**
 * Navigates to the next question as host.
 */
export async function nextQuestion(hostPage: Page): Promise<void> {
  await hostPage.getByRole('button', { name: /next|forward|right|chevronright/i }).click();
}

/**
 * Navigates to the previous question as host.
 */
export async function prevQuestion(hostPage: Page): Promise<void> {
  await hostPage.getByRole('button', { name: /previous|back|left|chevronleft/i }).click();
}

/**
 * Scores an answer as correct by clicking the checkmark button for a team.
 */
export async function markAnswerCorrect(hostPage: Page, teamName: string): Promise<void> {
  // Find the answer card for the team and click the check button
  const answerCard = hostPage.locator(`text=${teamName}`).locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
  await answerCard.getByRole('button', { name: /Mark correct/i }).click();
}

/**
 * Scores an answer as incorrect by clicking the X button for a team.
 */
export async function markAnswerIncorrect(hostPage: Page, teamName: string): Promise<void> {
  // Find the answer card for the team and click the X button
  const answerCard = hostPage.locator(`text=${teamName}`).locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
  await answerCard.getByRole('button', { name: /Mark incorrect/i }).click();
}

/**
 * Adds bonus points to an answer.
 */
export async function addBonus(hostPage: Page, teamName: string, clicks: number = 1): Promise<void> {
  const answerCard = hostPage.locator(`text=${teamName}`).locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
  for (let i = 0; i < clicks; i++) {
    await answerCard.getByRole('button', { name: /Add bonus points/i }).click();
  }
}

/**
 * Subtracts bonus points from an answer.
 */
export async function subtractBonus(hostPage: Page, teamName: string, clicks: number = 1): Promise<void> {
  const answerCard = hostPage.locator(`text=${teamName}`).locator('xpath=ancestor::div[contains(@class, "rounded-4xl")]');
  for (let i = 0; i < clicks; i++) {
    await answerCard.getByRole('button', { name: /Remove bonus points/i }).click();
  }
}
