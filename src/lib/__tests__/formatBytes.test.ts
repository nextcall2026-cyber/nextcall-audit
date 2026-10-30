import { describe, it, expect } from 'vitest';
import { formatBytes, formatCount } from '@/lib/formatBytes';

describe('formatBytes', () => {
  it('keeps small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('scales to KB, MB and GB with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3250586)).toBe('3.1 MB');
    expect(formatBytes(1288490189)).toBe('1.2 GB');
  });

  it('drops the decimal for three-digit values', () => {
    expect(formatBytes(150 * 1024)).toBe('150 KB');
  });

  it('treats nonsense as zero', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatCount', () => {
  it('shows plain numbers under a thousand', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(812)).toBe('812');
  });

  it('compacts thousands and millions', () => {
    expect(formatCount(1234)).toBe('1.2k');
    expect(formatCount(45678)).toBe('46k');
    expect(formatCount(2500000)).toBe('2.5M');
  });
});
