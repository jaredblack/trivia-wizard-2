// Unit tests for image upload helpers. Run with `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin, newImageName } from "../../src/features/host/editor/imageUpload";

test("fitWithin caps the longest edge and never enlarges", () => {
  assert.deepEqual(fitWithin(5120, 2880), { width: 2560, height: 1440 });
  assert.deepEqual(fitWithin(1000, 4000, 2000), { width: 500, height: 2000 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 100), { width: 100, height: 1 });
});

test("newImageName avoids names already in use", () => {
  const seq = [0, 0, 0.5];
  let i = 0;
  const random = () => seq[Math.min(i++, seq.length - 1)];
  assert.equal(newImageName(["img-0000", "IMG-0001"], random), "img-8000");
  assert.match(newImageName([]), /^img-[0-9a-f]{4}$/);
});
