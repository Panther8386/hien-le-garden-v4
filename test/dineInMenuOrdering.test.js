import { describe, it, expect } from 'vitest';
import { computeInsertionOrder } from '../lib/dineInMenuOrdering.js';

describe('computeInsertionOrder', () => {
  it('places the new item alone when the list is empty', () => {
    expect(computeInsertionOrder([], 'Hải sản')).toEqual([null]);
  });

  it('appends a new block at the end when the subgroup does not exist yet', () => {
    const existing = [
      { id: 1, subgroup: 'Hải sản' },
      { id: 2, subgroup: 'Hải sản' },
      { id: 3, subgroup: 'Món gà' },
    ];
    expect(computeInsertionOrder(existing, 'Lẩu')).toEqual([1, 2, 3, null]);
  });

  it('inserts at the end of an existing matching block, preserving other blocks order', () => {
    const existing = [
      { id: 1, subgroup: 'Hải sản' },
      { id: 2, subgroup: 'Hải sản' },
      { id: 3, subgroup: 'Món gà' },
    ];
    expect(computeInsertionOrder(existing, 'Hải sản')).toEqual([1, 2, null, 3]);
  });

  it('groups items with no subgroup (null) as their own block', () => {
    const existing = [
      { id: 1, subgroup: null },
      { id: 2, subgroup: 'Hải sản' },
    ];
    expect(computeInsertionOrder(existing, null)).toEqual([1, null, 2]);
  });

  it('treats an empty-string target subgroup the same as null', () => {
    const existing = [{ id: 1, subgroup: null }];
    expect(computeInsertionOrder(existing, '')).toEqual([1, null]);
  });
});
