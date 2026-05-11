import { BadRequestException } from '@nestjs/common';

export type RateBucket = {
  label: string;
  count: number;
  percentage: number;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateString(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && value === date.toISOString().slice(0, 10);
}

export function assertDateString(value: string, fieldName = 'date') {
  if (!validateDateString(value)) {
    throw new BadRequestException(`${fieldName} must be YYYY-MM-DD`);
  }
}

export function parseCsvIds(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function calculateRate(present: number, absent: number): number {
  const total = present + absent;
  if (total === 0) return 0;
  return Number(((present / total) * 100).toFixed(1));
}

export function calculateBuckets(rates: number[]): RateBucket[] {
  const buckets = [
    { label: '0-20', min: 0, max: 20 },
    { label: '20-40', min: 20, max: 40 },
    { label: '40-60', min: 40, max: 60 },
    { label: '60-80', min: 60, max: 80 },
    { label: '80-100', min: 80, max: 100 },
  ];

  return buckets.map((bucket) => {
    const count = rates.filter((rate) =>
      bucket.max === 100
        ? rate >= bucket.min && rate <= bucket.max
        : rate >= bucket.min && rate < bucket.max,
    ).length;
    return {
      label: bucket.label,
      count,
      percentage: rates.length === 0 ? 0 : Number(((count / rates.length) * 100).toFixed(1)),
    };
  });
}

export function calculatePercentiles(rates: number[]) {
  const sorted = [...rates].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

// Linear interpolation keeps percentile output stable for small classes.
function percentile(sortedRates: number[], percentileValue: number): number {
  if (sortedRates.length === 0) return 0;
  const index = (percentileValue / 100) * (sortedRates.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return Number(sortedRates[lower].toFixed(1));
  const fraction = index - lower;
  return Number(
    (
      sortedRates[lower] +
      (sortedRates[upper] - sortedRates[lower]) * fraction
    ).toFixed(1),
  );
}
