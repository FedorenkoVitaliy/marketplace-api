/** Сума в копійках. Брендований number — не змішувати з гривнями. */
export type Minor = number & { readonly __brand: 'minor' };

export const minor = (n: number): Minor => {
  if (!Number.isInteger(n)) {
    throw new RangeError(`сума має бути цілою в копійках, отримано ${n}`);
  }
  return n as Minor;
};

export const uah = (grn: number): Minor => {
  const cents = Math.round(grn * 100);
  if (Math.abs(cents - grn * 100) > 1e-9) {
    throw new RangeError(`${grn} грн не переводиться в цілі копійки`);
  }
  return minor(cents);
};

export type CurrencyCode = 'UAH';

export const CURRENCY: CurrencyCode = 'UAH';
