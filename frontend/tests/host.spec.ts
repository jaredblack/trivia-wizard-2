import { test, expect } from '@playwright/test';

test('host can create a game and receives game state', async ({ page }) => {
  await page.goto('/host');

  // Wait for server to be detected as running
  await expect(page.getByText('Server running!')).toBeVisible();

  // Click the "Create Game with random game code" button
  await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();

  // Should navigate to /host/game and see the game code
  await expect(page).toHaveURL('/host/game');
  await expect(page.getByText('Game Code:')).toBeVisible();

  // Should see question controls (question 1 displayed)
  await expect(page.getByText('1')).toBeVisible();
});
