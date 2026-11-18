import { test, expect, Page } from '@playwright/test';
import { seedDecks, storedYaml } from './deck-helpers';

const DECK = `title: Trivia Night!
defaults:
  timer: 60
slides:
- join

- category: Date Your Meme
  subtitle: Half points for one year off.
  kind: numeric
  within: 1

- q: "'The Dress' went viral in which year?"   # keep me
  a: 2015
  image: globe
  timer: 45
  # ask Grace for a better one

- q: Most popular vehicle in Massachusetts?
  a: Toyota Rav4
  kind: multiple-choice
  choices: [Toyota Rav4, Ford F-150, Honda CR-V]
  answer-image: nope

- q: question text
  a: answer text

- q: Where is the Bean?
  kind: map
`;

const lines = (page: Page) => page.locator('[data-testid="deck-editor"] .view-lines');
const inspector = (page: Page) => page.getByTestId('inspector');
const heading = (page: Page) => page.getByTestId('inspector-heading');
/** The source pill in the same row as a labelled control. */
const sourceOf = (page: Page, label: string) =>
  inspector(page).locator('.inspector-row', { has: page.getByLabel(label, { exact: true }) }).locator('.inspector-source');

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedDecks(page, { deck0001: DECK });
  await page.goto('/host/events/deck0001');
  await expect(lines(page)).toContainText('The Dress');
}

const saved = (page: Page) => expect(page.getByText('Saved', { exact: true })).toBeVisible();

test.describe('Inspector', () => {
  test('follows the cursor and shows where each setting comes from', async ({ page }) => {
    await open(page);

    // Before the first slide: deck defaults.
    await expect(heading(page)).toHaveText('Deck defaults');
    await expect(inspector(page).getByLabel('Timer', { exact: true })).toHaveValue('60');
    await expect(sourceOf(page, 'Timer')).toHaveText('this deck×');
    await expect(sourceOf(page, 'Points')).toHaveText('built-in');

    await lines(page).getByText('a: 2015').click();
    await expect(heading(page)).toHaveText('Question 1');
    await expect(inspector(page).getByLabel('Type', { exact: true })).toHaveValue('numeric');
    await expect(sourceOf(page, 'Type')).toHaveText('category');
    await expect(inspector(page).getByLabel('Timer', { exact: true })).toHaveValue('45');
    await expect(sourceOf(page, 'Timer')).toHaveText('this question×');
    await expect(inspector(page).getByLabel('Scoring', { exact: true })).toHaveValue('range');
    await expect(sourceOf(page, 'Within')).toHaveText('category');
    await expect(sourceOf(page, 'Points')).toHaveText('built-in');

    await lines(page).getByText('kind: numeric').click();
    await expect(heading(page)).toHaveText('Category: Date Your Meme');
    await expect(inspector(page)).toContainText('apply to the 4 questions below');
    await expect(sourceOf(page, 'Type')).toHaveText('this category×');
    await expect(sourceOf(page, 'Timer')).toHaveText('deck');

    await lines(page).getByText('- join').click();
    await expect(heading(page)).toHaveText('Join slide');
  });

  test('previews the real slide in question and answer states', async ({ page }) => {
    await open(page);
    await lines(page).getByText('a: 2015').click();

    const preview = page.getByTestId('slide-preview');
    await expect(preview.locator('.question-number')).toHaveText('Question 1');
    await expect(preview.locator('.question-text')).toContainText("'The Dress' went viral");
    await expect(preview.locator('img.slide-image')).toBeVisible();
    await expect(preview.locator('.answer')).not.toHaveClass(/visible/);

    await inspector(page).getByRole('button', { name: 'Answer', exact: true }).click();
    await expect(preview.locator('.answer')).toHaveClass(/visible/);
    await expect(preview.locator('.answer')).toHaveText('A: 2015');

    // Typing updates the preview.
    await lines(page).getByText('a: 2015').click();
    await page.keyboard.press('End');
    await page.keyboard.type('9');
    await expect(preview.locator('.answer')).toHaveText('A: 20159');
  });

  test('changing a setting writes one line; resetting removes it', async ({ page }) => {
    await open(page);
    await lines(page).getByText('a: 2015').click();

    // Override an inherited value.
    const points = inspector(page).getByLabel('Points', { exact: true });
    await points.fill('100');
    await points.press('Enter');
    await expect(sourceOf(page, 'Points')).toHaveText('this question×');
    await saved(page);
    const yaml = await storedYaml(page, 'deck0001');
    expect(yaml).toContain('  timer: 45\n  points: 100\n  # ask Grace for a better one\n');
    // Nothing else moved: comments and quoting are intact.
    expect(yaml.replace('  points: 100\n', '')).toBe(DECK);

    // Change an existing value in place.
    await inspector(page).getByLabel('Timer', { exact: true }).fill('90');
    await inspector(page).getByLabel('Timer', { exact: true }).press('Enter');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  timer: 90\n  points: 100\n');

    // Reset goes back to the inherited value and deletes the line.
    await inspector(page).getByRole('button', { name: 'Reset Timer' }).click();
    await expect(inspector(page).getByLabel('Timer', { exact: true })).toHaveValue('60');
    await expect(sourceOf(page, 'Timer')).toHaveText('deck');
    await inspector(page).getByRole('button', { name: 'Reset Points' }).click();
    // Both overrides are gone, including the timer line the deck started with.
    await expect.poll(() => storedYaml(page, 'deck0001')).toBe(DECK.replace('  timer: 45\n', ''));

    // The edits are ordinary editor edits: undo brings them back.
    // (Playwright's desktop profiles report a Windows user agent, which is
    // what the editor reads to pick Ctrl over Cmd.)
    await lines(page).getByText('a: 2015').click();
    await page.keyboard.press('Control+z');
    await expect(sourceOf(page, 'Points')).toHaveText('this question×');
  });

  test('category and deck settings are edited at their own level', async ({ page }) => {
    await open(page);

    await lines(page).getByText('kind: numeric').click();
    await inspector(page).getByLabel('Points', { exact: true }).fill('25');
    await inspector(page).getByLabel('Points', { exact: true }).press('Enter');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  within: 1\n  points: 25\n');

    // Questions under the category now inherit it.
    await lines(page).getByText('a: 2015').click();
    await expect(inspector(page).getByLabel('Points', { exact: true })).toHaveValue('25');
    await expect(sourceOf(page, 'Points')).toHaveText('category');

    await lines(page).getByText('title: Trivia Night!').click();
    await inspector(page).getByLabel('Bonus step', { exact: true }).fill('10');
    await inspector(page).getByLabel('Bonus step', { exact: true }).press('Enter');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('defaults:\n  timer: 60\n  bonus: 10\nslides:');
  });

  test('shows what each answer is worth on a multi-answer question', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedDecks(page, {
      deck0001: `title: t
slides:
- q: Name the five great lakes
  kind: multi-answer
  a: [Ontario, Erie, Michigan, Superior, Huron]
`,
    });
    await page.goto('/host/events/deck0001');
    await lines(page).getByText('Name the five').click();
    const note = inspector(page).getByTestId('inspector-points-note');
    await expect(note).toHaveText('10 points per answer (5 boxes)');
    await expect(sourceOf(page, 'Answer boxes')).toHaveText('from answers');

    await inspector(page).getByLabel('Answer boxes', { exact: true }).fill('3');
    await inspector(page).getByLabel('Answer boxes', { exact: true }).press('Enter');
    await expect(note).toHaveText('16 points per answer (3 boxes), 48 max');
  });

  test('rejects a value the setting cannot take', async ({ page }) => {
    await open(page);
    await lines(page).getByText('a: 2015').click();

    const timer = inspector(page).getByLabel('Timer', { exact: true });
    await timer.fill('soon');
    await timer.press('Enter');
    await expect(timer).toHaveAttribute('aria-invalid', 'true');
    expect(await storedYaml(page, 'deck0001')).toBe(DECK);

    // A percentage is fine for `within`.
    const within = inspector(page).getByLabel('Within', { exact: true });
    await within.fill('10%');
    await within.press('Enter');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  within: 10%\n');
  });

  test('picks the correct choice and a map location', async ({ page }) => {
    await open(page);

    await lines(page).getByText('a: Toyota Rav4').click();
    const answer = inspector(page).getByLabel('Answer', { exact: true });
    await expect(answer).toHaveValue('0');
    await answer.selectOption({ label: 'B. Ford F-150' });
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  a: Ford F-150\n  kind: multiple-choice');

    await lines(page).getByText('kind: map').click();
    await expect(heading(page)).toHaveText('Question 4');
    const location = inspector(page).getByLabel('Location', { exact: true });
    await location.fill('41.8827, -87.6233');
    await location.press('Enter');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  kind: map\n  location: [41.8827, -87.6233]\n');
    await expect(inspector(page).getByText(/map question with no `location`/)).toHaveCount(0);
  });

  test('moves an image between question and answer, and removes it', async ({ page }) => {
    await open(page);
    await lines(page).getByText('a: 2015').click();

    const images = page.getByTestId('inspector-images');
    await images.getByLabel('When globe appears').selectOption('answer-image');
    await expect.poll(() => storedYaml(page, 'deck0001')).toContain('  timer: 45\n  answer-image: globe\n');
    expect(await storedYaml(page, 'deck0001')).not.toContain('  image: globe');
    await expect(page.getByTestId('slide-preview').locator('img.slide-image')).toHaveClass(/fragment/);

    await images.getByRole('button', { name: 'Remove globe' }).click();
    await expect.poll(() => storedYaml(page, 'deck0001')).not.toContain('globe');
  });

  test('uploads a chosen file to the slide being inspected', async ({ page }) => {
    await open(page);
    await lines(page).getByText('a: answer text').click();
    await expect(heading(page)).toHaveText('Question 3');

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    await page.getByTestId('inspector-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });

    await expect(page.getByText(/^Image added as img-/)).toBeVisible();
    await expect.poll(() => storedYaml(page, 'deck0001')).toMatch(/ {2}a: answer text\n {2}image: img-[0-9a-f]{4}\n/);
    await expect(page.getByTestId('inspector-images').locator('img.inspector-thumb')).toHaveCount(1);
  });

  test('lists problems in plain words and jumps to them', async ({ page }) => {
    await open(page);

    const problems = page.getByTestId('inspector-problems');
    await expect(problems).toContainText('Problems (4)');
    await expect(problems).toContainText("Question 3 is numeric but its answer isn't a number");
    await expect(problems).toContainText('No image called "nope" in this event or the shared images.');
    await expect(problems).toContainText('Question 3 still has placeholder text.');
    await expect(problems).toContainText('Question 4 is a map question with no `location`');

    await problems.getByRole('button', { name: 'Question 3 still has placeholder text.' }).click();
    await expect(heading(page)).toHaveText('Question 3');
  });

  test('badges mark only questions that differ from the deck defaults', async ({ page }) => {
    await open(page);
    const badges = page.locator('[data-testid="deck-editor"] .q-badge');
    await expect(badges).toHaveText(['numeric ±1 · 45s', 'multiple choice', 'numeric ±1', 'map']);
  });
  test('resizes by dragging its edge and collapses to a rail', async ({ page }) => {
    await open(page);
    const resizer = page.getByRole('separator', { name: 'Resize inspector' });
    const width = async () => (await inspector(page).boundingBox())!.width;
    expect(Math.round(await width())).toBe(400);

    const box = (await resizer.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(box.x - 150, y, { steps: 5 });
    await page.mouse.up();
    expect(Math.round(await width())).toBeGreaterThan(530);

    // Width survives a reload.
    await page.reload();
    await expect(lines(page)).toContainText('The Dress');
    expect(Math.round(await width())).toBeGreaterThan(530);

    await page.getByRole('button', { name: 'Hide inspector' }).click();
    await expect(inspector(page)).toHaveCount(0);
    await expect(page.getByTestId('inspector-rail')).toBeVisible();

    await page.getByRole('button', { name: 'Show inspector' }).click();
    expect(Math.round(await width())).toBeGreaterThan(530);

    // Double-clicking the edge resets to the default width.
    await resizer.dblclick();
    expect(Math.round(await width())).toBe(400);
  });
});
