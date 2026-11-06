import { checkOutcome, PENDING_TTL_MS } from './check-transitions';

const now = new Date('2026-11-06T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe('checkOutcome', () => {
  it('bien → active, venga de pending o de failed', () => {
    expect(checkOutcome({ current: 'PENDING', ok: true, addedAt: daysAgo(1), now })).toEqual({
      kind: 'set',
      status: 'ACTIVE',
    });
    expect(checkOutcome({ current: 'FAILED', ok: true, addedAt: null, now })).toEqual({
      kind: 'set',
      status: 'ACTIVE',
    });
  });

  it('mal y estaba active o failed → failed', () => {
    for (const current of ['ACTIVE', 'FAILED'] as const) {
      expect(checkOutcome({ current, ok: false, addedAt: null, now })).toEqual({
        kind: 'set',
        status: 'FAILED',
      });
    }
  });

  it('mal y pending reciente → sigue pending', () => {
    expect(checkOutcome({ current: 'PENDING', ok: false, addedAt: daysAgo(6), now })).toEqual({
      kind: 'set',
      status: 'PENDING',
    });
  });

  it('mal y pending de más de 7 días → se libera', () => {
    expect(checkOutcome({ current: 'PENDING', ok: false, addedAt: daysAgo(8), now })).toEqual({
      kind: 'release',
    });
  });

  it('un pending sin fecha de alta no se libera por tiempo', () => {
    expect(checkOutcome({ current: 'PENDING', ok: false, addedAt: null, now })).toEqual({
      kind: 'set',
      status: 'PENDING',
    });
  });

  it('el límite son 7 días exactos: a los 7 justos todavía no se libera', () => {
    const exact = new Date(now.getTime() - PENDING_TTL_MS);

    expect(checkOutcome({ current: 'PENDING', ok: false, addedAt: exact, now })).toEqual({
      kind: 'set',
      status: 'PENDING',
    });
  });
});
