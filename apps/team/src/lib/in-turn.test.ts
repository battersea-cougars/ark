import { describe, expect, it } from "vitest";
import { inTurn } from "./in-turn";

/** A request the test answers when it likes: what was sent, in order, and a way to answer each. */
function slowServer() {
  const sent: string[] = [];
  const answers = new Map<string, () => void>();
  const request = (what: string) => () => {
    sent.push(what);
    return new Promise<string>((done) => answers.set(what, () => done(what)));
  };
  return { sent, request, answer: (what: string) => answers.get(what)!() };
}

/** Everything already answered has run on. */
const settled = () => new Promise((done) => setTimeout(done, 0));

describe("one person's taps reach the server in turn (the register: added, then let in)", () => {
  it("doesn't send Let in for someone until adding them has been answered", async () => {
    const server = slowServer();
    const turn = inTurn<number>();
    const added = turn(7, server.request("add Tam"));
    const letIn = turn(7, server.request("let Tam in"));
    await settled();
    expect(server.sent).toEqual(["add Tam"]);
    server.answer("add Tam");
    await added;
    await settled();
    expect(server.sent).toEqual(["add Tam", "let Tam in"]);
    server.answer("let Tam in");
    expect(await letIn).toBe("let Tam in");
  });

  it("lets taps for different people go at once", async () => {
    const server = slowServer();
    const turn = inTurn<number>();
    void turn(7, server.request("add Tam"));
    void turn(8, server.request("add Wes"));
    await settled();
    expect(server.sent).toEqual(["add Tam", "add Wes"]);
  });

  it("sends the next tap even when the one before it failed", async () => {
    const turn = inTurn<number>();
    const failed = turn(7, () => Promise.reject(new Error("offline")));
    const next = turn(7, async () => "let Tam in");
    await expect(failed).rejects.toThrow("offline");
    expect(await next).toBe("let Tam in");
  });
});
