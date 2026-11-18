import { test, expect, Page } from '@playwright/test';
import { NEW_DECK, seedDecks, storedYaml } from './deck-helpers';

const editorLines = (page: Page) => page.locator('[data-testid="deck-editor"] .view-lines');

/** Dispatch a paste or drop carrying a freshly drawn PNG onto the editor. */
async function sendImage(
  page: Page,
  how: 'paste' | 'drop',
  opts: { withText?: string; at?: { x: number; y: number } } = {}
): Promise<void> {
  await page.evaluate(
    async ({ how, withText, at }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#c0392b';
      g.fillRect(0, 0, 64, 48);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png')
      );
      const data = new DataTransfer();
      data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
      if (withText) data.setData('text/plain', withText);

      const editor = document.querySelector('[data-testid="deck-editor"]')!;
      const target =
        how === 'paste'
          ? (editor.querySelector('textarea, .native-edit-context') ?? editor)
          : (document.elementFromPoint(at!.x, at!.y) ?? editor);
      const event =
        how === 'paste'
          ? new ClipboardEvent('paste', { bubbles: true, cancelable: true })
          : new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              clientX: at!.x,
              clientY: at!.y,
            });
      // Constructors don't reliably accept the payload in every browser.
      Object.defineProperty(event, how === 'paste' ? 'clipboardData' : 'dataTransfer', {
        value: data,
      });
      target.dispatchEvent(event);
    },
    { how, withText: opts.withText, at: opts.at }
  );
}

test.describe('Deck images', () => {
  test('pasting an image uploads it and attaches it to the question', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    await editorLines(page).getByText('a: Paris').click();
    await sendImage(page, 'paste');

    await expect(page.getByText(/^Image added as img-[0-9a-f]{4}\.$/)).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    const yaml = await storedYaml(page, 'deck0001');
    const name = yaml.match(/image: (img-[0-9a-f]{4})/)?.[1];
    expect(name).toBeTruthy();
    // On question 1 only, right after its answer.
    expect(yaml).toContain(`  a: Paris\n  image: ${name}\n`);
    expect(yaml.match(/image: img-/g)).toHaveLength(1);

    // A thumbnail appears in the gutter next to the new line.
    await expect(page.locator('[data-testid="deck-editor"] .img-thumb')).toHaveCount(2);

    // The slides show it with the question.
    await page.goto('/present/deck0001#/3');
    const img = page.locator('.reveal .slides > section.present img.slide-image');
    await expect(img).toBeVisible();
    await expect(img).not.toHaveClass(/fragment/);
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(64);
  });

  test('a second image turns the line into a list', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    await editorLines(page).getByText('a: Paris').click();
    await sendImage(page, 'paste');
    await expect(page.getByText(/^Image added as/)).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await sendImage(page, 'paste');
    await expect(page.getByText(/^Image added as/)).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await expect
      .poll(() => storedYaml(page, 'deck0001'))
      .toMatch(/ {2}a: Paris\n {2}image:\n {2}- img-[0-9a-f]{4}\n {2}- img-[0-9a-f]{4}\n/);
  });

  test('dropping an image attaches it to the slide under the pointer', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    // Cursor on question 1, pointer over question 2's answer line.
    await editorLines(page).getByText('a: Paris').click();
    const box = await editorLines(page).getByText('a: Mars').boundingBox();
    await sendImage(page, 'drop', {
      at: { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    });

    await expect(page.getByText(/^Image added as/)).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    const yaml = await storedYaml(page, 'deck0001');
    // Question 2 already had `image: globe`; the new one joins it.
    expect(yaml).toMatch(/ {2}image:\n {2}- globe\n {2}- img-[0-9a-f]{4}\n/);
    expect(yaml).toContain("  a: Paris\n\n- q: Which planet");
  });

  test('pasting outside a slide explains what to do and uploads nothing', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    await editorLines(page).getByText('subtitle: Slice one').click();
    await sendImage(page, 'paste');

    await expect(
      page.getByText('Put the cursor in a question, category or image slide, then paste again.')
    ).toBeVisible();
    expect(await storedYaml(page, 'deck0001')).toBe(NEW_DECK);
  });

  test('a paste that also carries text stays a text paste', async ({ page }) => {
    await seedDecks(page, { deck0001: NEW_DECK });
    await page.goto('/host/events/deck0001');

    await editorLines(page).getByText('a: Paris').click();
    await sendImage(page, 'paste', { withText: 'spreadsheet cells' });

    await expect(page.getByText(/Uploading image|Image added/)).toHaveCount(0);
    await expect(page.locator('[data-testid="deck-editor"] .img-thumb')).toHaveCount(1);
  });
});
