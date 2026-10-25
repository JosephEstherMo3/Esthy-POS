import { describe, expect, it } from "vitest";
import { addDays, calculateChange, calculateTotals, formatMoney, fromCents, MoneyError, toCents, todayInTz } from "@/lib/money";

const lines = [
  { unitPriceCents: 1000, quantity: 3 }, // 30.00
  { unitPriceCents: 550, quantity: 2 }, // 11.00
];

describe("checkout calculations", () => {
  it("sums line items in integer cents", () => {
    const t = calculateTotals({ lines, discountType: "none", discountValue: 0, taxRatePercent: 0, taxInclusive: false });
    expect(t).toEqual({ subtotalCents: 4100, discountCents: 0, taxCents: 0, totalCents: 4100 });
  });

  it("applies a percentage discount then exclusive tax", () => {
    const t = calculateTotals({ lines, discountType: "percent", discountValue: 10, taxRatePercent: 7.5, taxInclusive: false });
    expect(t.discountCents).toBe(410);
    expect(t.taxCents).toBe(277); // 36.90 * 7.5% = 2.7675 -> 2.77
    expect(t.totalCents).toBe(3690 + 277);
    expect(fromCents(t.totalCents)).toBe("39.67");
  });

  it("applies a fixed discount", () => {
    const t = calculateTotals({ lines, discountType: "fixed", discountValue: 5.25, taxRatePercent: 0, taxInclusive: false });
    expect(t.discountCents).toBe(525);
    expect(t.totalCents).toBe(3575);
  });

  it("extracts tax from tax-inclusive prices without changing the total", () => {
    const t = calculateTotals({ lines: [{ unitPriceCents: 11000, quantity: 1 }], discountType: "none", discountValue: 0, taxRatePercent: 10, taxInclusive: true });
    expect(t.taxCents).toBe(1000);
    expect(t.totalCents).toBe(11000);
  });

  it("avoids floating point drift", () => {
    const t = calculateTotals({ lines: [{ unitPriceCents: toCents("0.10"), quantity: 3 }], discountType: "none", discountValue: 0, taxRatePercent: 0, taxInclusive: false });
    expect(t.totalCents).toBe(30);
    expect(toCents("19.99") * 3).toBe(5997);
  });

  it("rejects invalid discounts, quantities and prices", () => {
    const base = { lines, taxRatePercent: 0, taxInclusive: false };
    expect(() => calculateTotals({ ...base, discountType: "percent", discountValue: 101 })).toThrow(MoneyError);
    expect(() => calculateTotals({ ...base, discountType: "percent", discountValue: -1 })).toThrow(MoneyError);
    expect(() => calculateTotals({ ...base, discountType: "fixed", discountValue: 41.01 })).toThrow(MoneyError);
    expect(() => calculateTotals({ ...base, lines: [{ unitPriceCents: 100, quantity: 0 }], discountType: "none", discountValue: 0 })).toThrow(MoneyError);
    expect(() => calculateTotals({ ...base, lines: [{ unitPriceCents: 100, quantity: 1.5 }], discountType: "none", discountValue: 0 })).toThrow(MoneyError);
    expect(() => calculateTotals({ ...base, lines: [{ unitPriceCents: -1, quantity: 1 }], discountType: "none", discountValue: 0 })).toThrow(MoneyError);
  });
});

describe("change calculation", () => {
  it("returns change for cash payments", () => {
    expect(calculateChange(3967, 5000)).toBe(1033);
    expect(calculateChange(3967, 3967)).toBe(0);
  });
  it("rejects insufficient or invalid payments", () => {
    expect(() => calculateChange(3967, 3966)).toThrow(MoneyError);
    expect(() => calculateChange(3967, -1)).toThrow(MoneyError);
  });
});

describe("formatting and dates", () => {
  it("formats currency consistently", () => {
    expect(formatMoney("1234.5", "USD", "en-US")).toBe("$1,234.50");
    expect(formatMoney(5, "NGN", "en-US", "code")).toMatch(/NGN\s5\.00/);
  });
  it("computes the business day in the given timezone", () => {
    const instant = new Date("2025-03-10T23:30:00Z");
    expect(todayInTz("UTC", instant)).toBe("2025-03-10");
    expect(todayInTz("Africa/Lagos", instant)).toBe("2025-03-11"); // UTC+1 → already next day
    expect(todayInTz("America/Los_Angeles", instant)).toBe("2025-03-10");
  });
  it("adds days across month boundaries", () => {
    expect(addDays("2025-02-27", 3)).toBe("2025-03-02");
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
  });
});
