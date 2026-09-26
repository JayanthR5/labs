import { describe, expect, it } from 'vitest';
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
describe('lead validation', () => { it('accepts normal addresses and rejects malformed values', () => { expect(validEmail.test('person@example.com')).toBe(true); expect(validEmail.test('person@example')).toBe(false); }); });
