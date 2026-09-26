import { describe, expect, it } from 'vitest';
import { urgentUpgrade } from '../src/firmware/advisory';

describe('urgent upgrade rule', () => {
  it('flags 4.x below 4.2.0, but not the unaffected 3.x', () => {
    expect(urgentUpgrade('4.1.9')).toEqual({ fixedIn: '4.2.0' });
    expect(urgentUpgrade('4.0.1')).toEqual({ fixedIn: '4.2.0' });
    expect(urgentUpgrade('3.2.2')).toBeNull();
    expect(urgentUpgrade('3.0.6')).toBeNull();
    expect(urgentUpgrade('4.2.0')).toBeNull();
    expect(urgentUpgrade('4.2.1')).toBeNull();
  });

  it('flags 5.x below 5.6.0', () => {
    expect(urgentUpgrade('5.5.9')).toEqual({ fixedIn: '5.6.0' });
    expect(urgentUpgrade('5.4.5')).toEqual({ fixedIn: '5.6.0' });
    expect(urgentUpgrade('5.0.0')).toEqual({ fixedIn: '5.6.0' });
    expect(urgentUpgrade('5.6.0')).toBeNull();
    expect(urgentUpgrade('5.10.0')).toBeNull();
  });

  it('flags Q1 releases below 1.5.0Q', () => {
    expect(urgentUpgrade('1.4.1Q')).toEqual({ fixedIn: '1.5.0Q' });
    expect(urgentUpgrade('0.0.3Q')).toEqual({ fixedIn: '1.5.0Q' });
    expect(urgentUpgrade('1.5.0Q')).toBeNull();
    expect(urgentUpgrade('1.5.2Q')).toBeNull();
  });

  it('leaves Edge builds and unreadable versions alone', () => {
    expect(urgentUpgrade('6.3.3X')).toBeNull();
    expect(urgentUpgrade('6.3.3QX')).toBeNull();
    expect(urgentUpgrade('')).toBeNull();
    expect(urgentUpgrade('banana')).toBeNull();
  });
});
