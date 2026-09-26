import { describe, expect, it } from 'vitest';
import { shouldRetry } from '../src/retry';
describe('worker retries', () => { it('keeps transient failures scheduled until the final attempt', () => { expect(shouldRetry(0, 3)).toBe(true); expect(shouldRetry(1, 3)).toBe(true); expect(shouldRetry(2, 3)).toBe(false); }); });
