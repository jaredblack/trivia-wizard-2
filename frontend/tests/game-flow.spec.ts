import { test, expect, type Page } from '@playwright/test';

async function joinTeam(page: Page, gameCode: string, teamName: string, color: string) {
  await page.goto('/join');
  await page.getByPlaceholder('Game code').fill(gameCode);
  await page.getByPlaceholder('Team name').fill(teamName);
  await page.getByRole('button', { name: 'Next' }).click();

  // Members step - add a member and continue
  await page.getByPlaceholder('Member 1').fill(`${teamName} Player`);
  await page.getByRole('button', { name: 'Next' }).click();

  // Color step - select color and join
  await page.getByRole('button', { name: color }).click();
  await page.getByRole('button', { name: 'Join' }).click();

  // Wait for game view
  await expect(page.getByText('Submissions are not yet open')).toBeVisible();
}

async function submitAnswer(page: Page, answer: string) {
  await page.getByLabel('Answer').fill(answer);
  await page.getByRole('button', { name: 'Submit Answer' }).click();
  await expect(page.getByText('Submissions closed')).toBeVisible();
}

test('full game flow with scoring across multiple questions', async ({ browser }) => {
  // Create three browser contexts
  const hostContext = await browser.newContext();
  const teamAContext = await browser.newContext();
  const teamBContext = await browser.newContext();

  const hostPage = await hostContext.newPage();
  const teamAPage = await teamAContext.newPage();
  const teamBPage = await teamBContext.newPage();

  // 1. Host creates a game
  await hostPage.goto('/host');
  await expect(hostPage.getByText('Server running!')).toBeVisible();
  await hostPage.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();

  await expect(hostPage).toHaveURL('/host/game');
  const gameCodeElement = hostPage.locator('text=Game Code:').locator('..').locator('.font-bold');
  const gameCode = await gameCodeElement.textContent();
  expect(gameCode).toBeTruthy();

  // 1a. Host adjusts game settings: 10 question points, 1 bonus increment
  await hostPage.getByLabel('DefaultQuestion Points').fill('10');
  await hostPage.getByLabel('Default Bonus Increment').fill('1');

  // 2 & 3. Teams A and B join the game
  await joinTeam(teamAPage, gameCode!, 'Team A', 'Blue');
  await joinTeam(teamBPage, gameCode!, 'Team B', 'Orange');

  // Verify both teams appear on host scoreboard
  await expect(hostPage.getByText('Team A')).toBeVisible();
  await expect(hostPage.getByText('Team B')).toBeVisible();

  // 4. Host starts timer (opens answers)
  await hostPage.getByRole('button', { name: 'Start timer' }).click();

  // 5. Teams A & B both answer, team A first
  await expect(teamAPage.getByLabel('Answer')).toBeVisible();
  await expect(teamBPage.getByLabel('Answer')).toBeVisible();

  await submitAnswer(teamAPage, 'George Washington');
  await submitAnswer(teamBPage, 'George Washington');

  // Wait for answers to appear on host
  await expect(hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team A' })).toBeVisible();
  await expect(hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team B' })).toBeVisible();

  // 6. Host scores both correct, gives Team A one bonus point
  const teamACard = hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team A' });
  const teamBCard = hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team B' });

  await teamACard.getByRole('button', { name: 'Mark correct' }).click();
  await teamACard.getByRole('button', { name: 'Add bonus points' }).click();
  await teamBCard.getByRole('button', { name: 'Mark correct' }).click();

  // Verify scores on team pages: Team A = 11, Team B = 10
  await expect(teamAPage.getByText('Score: 11')).toBeVisible();
  await expect(teamBPage.getByText('Score: 10')).toBeVisible();

  // 7. Host moves to question 2
  await hostPage.getByRole('button', { name: 'Next question' }).click();
  await expect(hostPage.locator('text=Question').locator('..').getByText('2')).toBeVisible();

  // 8. Host changes Q2 settings: 20 points, 2 bonus increment
  await hostPage.getByLabel('Question Points').fill('20');
  await hostPage.getByLabel('Bonus Increment').fill('2');

  // 9. Host starts timer, teams answer (Team B first this time)
  await hostPage.getByRole('button', { name: 'Start timer' }).click();
  await expect(teamAPage.getByLabel('Answer')).toBeVisible();
  await expect(teamBPage.getByLabel('Answer')).toBeVisible();

  await submitAnswer(teamBPage, 'Abraham Lincoln');
  await submitAnswer(teamAPage, 'Abraham Lincoln');

  // Wait for answers to appear on host
  await expect(hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team A' })).toBeVisible();
  await expect(hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team B' })).toBeVisible();

  // 10. Host scores both correct, gives Team B 2 bonus points (one click = 2 points now)
  const teamACardQ2 = hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team A' });
  const teamBCardQ2 = hostPage.locator('[class*="rounded-4xl"]').filter({ hasText: 'Team B' });

  await teamBCardQ2.getByRole('button', { name: 'Mark correct' }).click();
  await teamBCardQ2.getByRole('button', { name: 'Add bonus points' }).click();
  await teamACardQ2.getByRole('button', { name: 'Mark correct' }).click();

  // Verify final scores: Team A = 11 + 20 = 31, Team B = 10 + 20 + 2 = 32
  await expect(teamAPage.getByText('Score: 31')).toBeVisible();
  await expect(teamBPage.getByText('Score: 32')).toBeVisible();

  // 11. Host navigates Q1 -> Q2 -> Q3, scores should not change
  await hostPage.getByRole('button', { name: 'Previous question' }).click();
  await expect(hostPage.locator('text=Question').locator('..').getByText('1')).toBeVisible();

  await hostPage.getByRole('button', { name: 'Next question' }).click();
  await expect(hostPage.locator('text=Question').locator('..').getByText('2')).toBeVisible();

  await hostPage.getByRole('button', { name: 'Next question' }).click();
  await expect(hostPage.locator('text=Question').locator('..').getByText('3')).toBeVisible();

  // Scores should remain unchanged after navigation
  await expect(teamAPage.getByText('Score: 31')).toBeVisible();
  await expect(teamBPage.getByText('Score: 32')).toBeVisible();

  // Cleanup
  await hostContext.close();
  await teamAContext.close();
  await teamBContext.close();
});
