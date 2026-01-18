import { test, expect } from '@playwright/test';

test.describe('Host Game Management', () => {
  test.describe('1.1 Game Creation', () => {
    test('host can create game with random code', async ({ page }) => {
      await page.goto('/host');

      // Wait for server to be detected as running
      await expect(page.getByText('Server running!')).toBeVisible();

      // Click the "Create Game with random game code" button
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();

      // Should navigate to /host/game
      await expect(page).toHaveURL('/host/game');

      // Should see the game code label
      await expect(page.getByText('Game Code:')).toBeVisible();

      // Verify a 4-letter game code is displayed
      const gameCodeText = await page.locator('text=Game Code:').locator('xpath=..').textContent();
      expect(gameCodeText).toMatch(/[A-Z]{4}/);

      // Should see question 1 displayed
      await expect(page.locator('text=/Question.*1|^1$/')).toBeVisible();
    });

    test('host can create game with custom code', async ({ page }) => {
      await page.goto('/host');

      // Wait for server to be detected as running
      await expect(page.getByText('Server running!')).toBeVisible();

      const customCode = 'TEST';

      // Enter custom game code in the input
      await page.getByPlaceholder('Game code').fill(customCode);

      // Click the "Create Game" button (the one next to the input, not the random one)
      await page.getByRole('button', { name: 'Create Game' }).filter({ hasNotText: 'random game code' }).click();

      // Should navigate to /host/game
      await expect(page).toHaveURL('/host/game');

      // Verify the exact custom code is displayed
      await expect(page.getByText(customCode)).toBeVisible();
    });
  });

  test.describe('1.2 Question Navigation', () => {
    test('host can navigate to next question', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Should start on question 1 - Question label and number are separate elements
      await expect(page.getByText('Question', { exact: true })).toBeVisible();
      const questionNumberElement = page.locator('.text-4xl.font-bold').filter({ hasText: /^\d+$/ });
      await expect(questionNumberElement).toHaveText('1');

      // Click next arrow (aria-label is "Next question")
      await page.getByRole('button', { name: 'Next question' }).click();

      // Verify question number incremented to 2
      await expect(questionNumberElement).toHaveText('2');
    });

    test('host can navigate to previous question', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      const questionNumberElement = page.locator('.text-4xl.font-bold').filter({ hasText: /^\d+$/ });

      // Navigate to question 2 first
      await page.getByRole('button', { name: 'Next question' }).click();
      await expect(questionNumberElement).toHaveText('2');

      // Click previous arrow (aria-label is "Previous question")
      await page.getByRole('button', { name: 'Previous question' }).click();

      // Verify question number decremented to 1
      await expect(questionNumberElement).toHaveText('1');
    });

    test('previous button disabled on question 1', async ({ page }) => {
      await page.goto('/host');
      await expect(page.getByText('Server running!')).toBeVisible();
      await page.getByRole('button', { name: /Create Game/i }).filter({ hasText: 'random game code' }).click();
      await expect(page).toHaveURL('/host/game');

      // Should be on question 1
      const questionNumberElement = page.locator('.text-4xl.font-bold').filter({ hasText: /^\d+$/ });
      await expect(questionNumberElement).toHaveText('1');

      // Verify previous button is disabled
      const prevButton = page.getByRole('button', { name: 'Previous question' });
      await expect(prevButton).toBeDisabled();
    });
  });
});
