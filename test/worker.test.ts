import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.ts';

test('GET / serves the Trip finance workspace landing page', async () => {
  const response = await worker.fetch(new Request('https://example.test/'), { DB: {} as D1Database }, {} as ExecutionContext);

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Create shared workspace/);
});
