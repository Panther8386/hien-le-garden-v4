import { describe, it, expect } from 'vitest';
import { PERMISSION_KEYS, ROLE_DEFAULTS, EDITABLE_ROLES, isValidPermission, effectivePermissions, hasPermission } from '../lib/permissions.js';

describe('permission catalog', () => {
  it('has 38 unique keys matching the spec table', () => {
    expect(PERMISSION_KEYS.length).toBe(38);
    expect(new Set(PERMISSION_KEYS).size).toBe(38);
  });

  it('only uses valid keys in role defaults', () => {
    for (const role of EDITABLE_ROLES) {
      for (const key of ROLE_DEFAULTS[role]) expect(isValidPermission(key)).toBe(true);
    }
  });

  it('gives observer only today-ops view and finance income view', () => {
    expect([...ROLE_DEFAULTS.observer].sort()).toEqual(['bookings.view', 'finance.view_income']);
  });

  it('rejects unknown keys', () => {
    expect(isValidPermission('bookings.fly')).toBe(false);
  });
});

describe('effectivePermissions', () => {
  it('gives admin every key regardless of inputs', () => {
    const set = effectivePermissions('admin', [], [{ permission: 'bookings.view', effect: 'deny' }]);
    expect(set.size).toBe(PERMISSION_KEYS.length);
  });

  it('adds grants and removes denies on top of the role set', () => {
    const set = effectivePermissions('reception', ['bookings.view', 'bookings.manage'], [
      { permission: 'assets.delete', effect: 'grant' },
      { permission: 'bookings.manage', effect: 'deny' },
    ]);
    expect([...set].sort()).toEqual(['assets.delete', 'bookings.view']);
  });

  it('treats a grant of a permission the role already has as a no-op', () => {
    const set = effectivePermissions('manager', ['finance.create'], [{ permission: 'finance.create', effect: 'grant' }]);
    expect([...set]).toEqual(['finance.create']);
  });

  it('ignores unknown keys stored in the database', () => {
    const set = effectivePermissions('reception', ['bookings.view', 'old.key'], [{ permission: 'gone.key', effect: 'grant' }]);
    expect([...set]).toEqual(['bookings.view']);
  });
});

describe('hasPermission', () => {
  it('reads the Set on the auth object', () => {
    expect(hasPermission({ permissions: new Set(['a.b']) }, 'a.b')).toBe(true);
    expect(hasPermission({ permissions: new Set() }, 'a.b')).toBe(false);
  });
});
