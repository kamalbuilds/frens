import { describe, expect, it } from "bun:test";
import { acceptedPost, telegramShareUrl, xPostUrl } from "./share";

const LINK = "https://frens.example/r/abc?net=testnet&n=b379:ana&c=0x1,0x2";

describe("share urls", () => {
  it("X intent carries the text and the full room link, query and all", () => {
    const u = new URL(xPostUrl("hi & bye", LINK));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("hi & bye");
    expect(u.searchParams.get("url")).toBe(LINK);
  });
  it("Telegram share keeps the link intact", () => {
    const u = new URL(telegramShareUrl("t", LINK));
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe(LINK);
  });
  it("the accepted post names the caller and the price", () => {
    expect(acceptedPost("cy", "84,819.0")).toContain("cy called my take-profit at 84,819.0");
  });
});
