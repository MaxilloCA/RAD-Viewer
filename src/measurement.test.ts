import { describe, expect, it } from 'vitest';
import { calibrationScale, measurementLabel } from './workspace';

describe('measurement display', () => {
  it('calculates a reference scale and rejects invalid references', () => {
    const reference = { start: { x: 10, y: 20 }, end: { x: 310, y: 420 } };
    expect(calibrationScale({ reference, knownLengthMm: 10 })).toBe(.02);
    for (const knownLengthMm of [0, -1, NaN, Infinity]) expect(calibrationScale({ reference, knownLengthMm })).toBeUndefined();
    expect(calibrationScale({ reference: { start: reference.start, end: reference.start }, knownLengthMm: 10 })).toBeUndefined();
    expect(calibrationScale()).toBeUndefined();
  });
  it('rounds lengths to one decimal and leaves the conversion replaceable for calibration', () => {
    expect(measurementLabel({ start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })).toBe('1.4 mm · uncalibrated');
    expect(measurementLabel({ start: { x: 10, y: 20 }, end: { x: 310, y: 420 } }, .02)).toBe('10.0 mm · estimated');
  });
});
