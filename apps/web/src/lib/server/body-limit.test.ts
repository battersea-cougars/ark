import { describe, expect, it } from "vitest";
import { withinLimit } from "./body-limit";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://site.test/api/join", { method: "POST", body, headers, duplex: "half" } as RequestInit);

/** A body that doesn't say how big it is: sent in pieces. */
const streamed = (pieces: number, size: number) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < pieces; i++) c.enqueue(new Uint8Array(size));
      c.close();
    },
  });

describe("a live route's body limit (#73)", () => {
  it("a form within it reads as it was sent", async () => {
    const r = await withinLimit(
      post("name=Reg&email=reg%40example.com", { "content-type": "application/x-www-form-urlencoded" }),
      1024,
    );
    expect((await r!.formData()).get("email")).toBe("reg@example.com");
  });

  it("one that says it's too big is refused before it's read", async () => {
    expect(await withinLimit(post("x", { "content-length": "999999" }), 1024)).toBeNull();
  });

  it("one that says nothing is refused once it's sent more than the limit", async () => {
    expect(await withinLimit(post(streamed(10, 200)), 1024)).toBeNull();
    expect(await withinLimit(post(streamed(4, 200)), 1024)).not.toBeNull();
  });
});
