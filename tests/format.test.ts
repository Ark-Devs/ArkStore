import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { downloadEstimate, duration } from '../src/lib/format';

describe('download time', () => {
  test('duration reads naturally', () => {
    assert.equal(duration(0.2), '1 sec');
    assert.equal(duration(8.4), '8 sec');
    assert.equal(duration(59.6), '1 min');
    assert.equal(duration(80), '1 min 20 sec');
    assert.equal(duration(62), '1 min');
    assert.equal(duration(725), '12 min');
  });

  test('estimate needs a measured speed', () => {
    const mb = 1_048_576;
    assert.equal(downloadEstimate(13.6 * mb, 1.5 * mb), '≈ 9 sec');
    assert.equal(downloadEstimate(39.6 * mb, 0.25 * mb), '≈ 2 min 38 sec');
    assert.equal(downloadEstimate(13.6 * mb, null), null, 'no guess before the first download');
    assert.equal(downloadEstimate(null, 1.5 * mb), null);
  });
});
