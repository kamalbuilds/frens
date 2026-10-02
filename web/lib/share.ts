// Share targets for a room link. Perpl traders post PnL on X and talk in Telegram, so those two, prefilled.
export function xPostUrl(text: string, url: string): string {
  return `https://x.com/intent/post?${new URLSearchParams({ text, url })}`;
}

export function telegramShareUrl(text: string, url: string): string {
  return `https://t.me/share/url?${new URLSearchParams({ url, text })}`;
}

export const ROOM_POST = "My Perpl positions, live on one chart with my frens. Think you know my exit? Call it.";

export function acceptedPost(caller: string, price: string): string {
  return `${caller} called my take-profit at ${price} on Perpl. I took the call, one signature, and it's on chain.`;
}
