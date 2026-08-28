import { describe, it, expect } from 'vitest';
import { ROOM_TYPES } from '../lib/roomTypes.js';

describe('ROOM_TYPES', () => {
  it('has exactly the six room types, each with a label and a price', () => {
    expect(Object.keys(ROOM_TYPES)).toEqual(['triangle', 'circle', 'ede_cozy', 'vip', 'bungalow', 'dormitory']);
    Object.values(ROOM_TYPES).forEach((t) => {
      expect(t.label).toBeTypeOf('string');
      expect(t.priceVnd).toBeTypeOf('number');
    });
  });

  it('matches the prices already published on bang-gia/index.html', () => {
    expect(ROOM_TYPES.triangle).toEqual({ label: 'Triangle House', priceVnd: 300000 });
    expect(ROOM_TYPES.circle).toEqual({ label: 'Circle House', priceVnd: 600000 });
    expect(ROOM_TYPES.ede_cozy).toEqual({ label: 'Ê Đê Cozy House', priceVnd: 600000 });
    expect(ROOM_TYPES.vip).toEqual({ label: 'VIP House', priceVnd: 900000 });
    expect(ROOM_TYPES.bungalow).toEqual({ label: 'Bungalow Gia Đình', priceVnd: 700000 });
    expect(ROOM_TYPES.dormitory).toEqual({ label: 'Phòng Tập Thể', priceVnd: 1200000 });
  });
});
