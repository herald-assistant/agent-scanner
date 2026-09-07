import {describe, expect, it} from 'vitest';
import {time} from './telemetry';

describe('telemetry time', () => {
  it('parses backend timestamps that preserve microseconds', () => {
    expect(time('2026-09-06T21:55:11.778593+02:00')).toBe(Date.parse('2026-09-06T21:55:11.778+02:00'));
  });

  it('keeps missing and malformed timestamps unavailable', () => {
    expect(time()).toBeNaN();
    expect(time('not-a-time')).toBeNaN();
  });
});
