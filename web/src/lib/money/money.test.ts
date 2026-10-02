import { describe, expect, it } from "vitest";
import {
  add,
  addRanges,
  centavos,
  formatPesos,
  formatRange,
  isCentavos,
  parsePesos,
  range,
  shareOf,
  subtractToZero,
} from "./index";

describe("centavos", () => {
  it("accepts whole, non-negative amounts", () => {
    expect(centavos(0)).toBe(0);
    expect(centavos(125050)).toBe(125050);
  });

  it.each([0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects %s",
    (value) => {
      expect(() => centavos(value)).toThrow(RangeError);
    },
  );

  it("isCentavos rejects non-numbers", () => {
    expect(isCentavos("100")).toBe(false);
    expect(isCentavos(null)).toBe(false);
    expect(isCentavos(100)).toBe(true);
  });
});

describe("parsePesos", () => {
  it.each([
    ["0", 0],
    ["350", 35000],
    ["350.5", 35050],
    ["350.50", 35050],
    ["0.05", 5],
    ["1,250.75", 125075],
    ["₱1,250.75", 125075],
    ["  ₱ 99 ", 9900],
  ])("parses %s", (input, expected) => {
    expect(parsePesos(input)).toBe(expected);
  });

  it("is exact where floats are not", () => {
    // 19.99 * 100 === 1998.9999999999998 in floating point.
    expect(parsePesos("19.99")).toBe(1999);
    expect(parsePesos("0.29")).toBe(29);
  });

  it.each(["", "abc", "-5", "1.234", "1.", ".5", "1e3", "12 34"])("rejects %j", (input) => {
    expect(() => parsePesos(input)).toThrow(RangeError);
  });
});

describe("formatPesos", () => {
  it.each([
    [0, "₱0.00"],
    [5, "₱0.05"],
    [35050, "₱350.50"],
    [125075, "₱1,250.75"],
    [100000000, "₱1,000,000.00"],
  ])("formats %d", (amount, expected) => {
    expect(formatPesos(centavos(amount))).toBe(expected);
  });

  it("round-trips with parsePesos", () => {
    for (const amount of [0, 1, 99, 100, 199999, 123456789]) {
      expect(parsePesos(formatPesos(centavos(amount)))).toBe(amount);
    }
  });
});

describe("arithmetic", () => {
  it("adds", () => {
    expect(add(centavos(10), centavos(20))).toBe(30);
  });

  it("never subtracts below zero", () => {
    expect(subtractToZero(centavos(500), centavos(200))).toBe(300);
    expect(subtractToZero(centavos(200), centavos(500))).toBe(0);
  });

  it("takes a share in basis points, rounding half up", () => {
    expect(shareOf(centavos(10000), 2000)).toBe(2000); // 20% of ₱100.00
    expect(shareOf(centavos(999), 2000)).toBe(200); // 199.8 -> 200
    expect(shareOf(centavos(1), 5000)).toBe(1); // 0.5 -> 1
    expect(shareOf(centavos(1), 4999)).toBe(0);
    expect(shareOf(centavos(12345), 0)).toBe(0);
  });

  it("keeps large shares exact", () => {
    expect(shareOf(centavos(900_000_000_000_001), 10000)).toBe(900_000_000_000_001);
  });

  it("rejects fractional or negative basis points", () => {
    expect(() => shareOf(centavos(100), 12.5)).toThrow(RangeError);
    expect(() => shareOf(centavos(100), -1)).toThrow(RangeError);
  });
});

describe("ranges", () => {
  it("requires min <= max", () => {
    expect(range(centavos(100), centavos(100))).toEqual({ min: 100, max: 100 });
    expect(() => range(centavos(200), centavos(100))).toThrow(RangeError);
  });

  it("adds ranges end to end", () => {
    const total = addRanges(
      range(centavos(35000), centavos(50000)),
      range(centavos(2000), centavos(6000)),
    );
    expect(total).toEqual({ min: 37000, max: 56000 });
  });

  it("formats as a range, never a single number", () => {
    expect(formatRange(range(centavos(35000), centavos(50000)))).toBe("₱350.00 – ₱500.00");
  });
});
