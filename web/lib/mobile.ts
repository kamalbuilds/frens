/// Perpl names every market with the venue suffix it trades under ("BTC
/// Perp"). Above 640px the tab group sits in the header with room to spare.
/// Below 640px it is a narrow horizontal strip that has to scroll, so the
/// suffix is cut and the tab reads "BTC".
/// A name without the suffix is handed back untouched: the venue owns those
/// names, this does not rename them.
export function shortMarketLabel(name: string): string {
  const suffix = " Perp";
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
