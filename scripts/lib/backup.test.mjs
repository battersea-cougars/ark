// A backup is the club's database, personal data included, kept where the public can list it (a GitHub artifact):
// only someone with the key can read it back, and a changed byte is noticed, not restored (ADR 0050).
import { describe, expect, it } from "vitest";
import { open, seal } from "./backup.mjs";

const SQL = "INSERT INTO members (name, email) VALUES ('Reg Player', 'reg@example.com');\n".repeat(200);

describe("sealing a backup", () => {
  it("gives back exactly what went in, with the same key", () => {
    expect(open(seal(SQL, "k3y"), "k3y")).toBe(SQL);
  });

  it("can't be read without the key: no email in it, and the wrong key is refused", () => {
    const sealed = seal(SQL, "k3y");
    expect(sealed.includes(Buffer.from("reg@example.com"))).toBe(false);
    expect(() => open(sealed, "guess")).toThrow(/key/);
  });

  it("refuses one that's been changed, or isn't a backup at all", () => {
    const sealed = seal(SQL, "k3y");
    sealed[sealed.length - 1] ^= 1;
    expect(() => open(sealed, "k3y")).toThrow();
    expect(() => open(Buffer.from("-- plain SQL"), "k3y")).toThrow(/not a backup/);
  });

  it("is smaller than the export, and never the same twice", () => {
    expect(seal(SQL, "k3y").length).toBeLessThan(SQL.length / 4);
    expect(seal(SQL, "k3y").equals(seal(SQL, "k3y"))).toBe(false);
  });

  it("needs a key", () => {
    expect(() => seal(SQL, "")).toThrow(/BACKUP_KEY/);
  });
});
