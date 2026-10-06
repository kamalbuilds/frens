// Same-origin relay to Perpl's testnet trading API. The browser holds the Ed25519 key and signs every request itself;
// this route only carries the signed bytes to testnet.perpl.xyz, which accepts server calls without an Origin header
// but answers a browser Origin it has not whitelisted with 404/400. Nothing is read, stored or logged here.
// Only the paths a stop-loss call needs are forwarded, and only for testnet: mainnet allows the browser origin directly.
const UPSTREAM = "https://testnet.perpl.xyz/api";
const ALLOWED = [
  /^v1\/api-key\/(payload|enroll)$/,
  /^v1\/pub\/context$/,
  /^v1\/trading\/(orders|wallet|positions|order-history)$/,
];
const FORWARD_HEADERS = ["content-type", "x-api-key", "x-api-timestamp", "x-api-nonce", "x-api-signature"];

async function relay(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const [env, ...rest] = (await ctx.params).path;
  const path = rest.join("/");
  if (env !== "testnet" || !ALLOWED.some((re) => re.test(path))) return Response.json({ error: "not relayed" }, { status: 404 });
  const url = new URL(req.url);
  const headers = new Headers();
  for (const h of FORWARD_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const body = req.method === "GET" ? undefined : await req.text();
  const res = await fetch(`${UPSTREAM}/${path}${url.search}`, { method: req.method, headers, body, cache: "no-store" });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

export const GET = relay;
export const POST = relay;
