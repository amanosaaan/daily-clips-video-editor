import { beforeEach, describe, expect, it } from 'vitest';
import { addRecentColor, getRecentColors } from './recentColors';

beforeEach(() => {
  localStorage.clear();
});

describe('recentColors', () => {
  it('returns an empty array when nothing has been saved yet', () => {
    expect(getRecentColors()).toEqual([]);
  });

  it('adds a color to the front of the list', () => {
    addRecentColor('#ff0000');
    addRecentColor('#00ff00');
    expect(getRecentColors()).toEqual(['#00ff00', '#ff0000']);
  });

  it('moves an already-used color to the front instead of duplicating it', () => {
    addRecentColor('#ff0000');
    addRecentColor('#00ff00');
    addRecentColor('#ff0000');
    expect(getRecentColors()).toEqual(['#ff0000', '#00ff00']);
  });

  it('keeps at most 5 colors, dropping the oldest', () => {
    ['#1', '#2', '#3', '#4', '#5', '#6'].forEach(addRecentColor);
    expect(getRecentColors()).toEqual(['#6', '#5', '#4', '#3', '#2']);
  });
});
