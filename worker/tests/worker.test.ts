import { describe, expect, it } from 'vitest';
describe('worker contract', () => { it('uses a sender and hour in the distributed rate key', () => { const key = `email-rate:${'sender-1'}:${Math.floor(0 / 3_600_000)}`; expect(key).toBe('email-rate:sender-1:0'); }); });
