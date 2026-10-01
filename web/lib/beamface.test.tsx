import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Avatar from "boring-avatars";
import { beamFace, BeamFace, BEAM_BOX } from "./beamface";

// The share card cannot render the library component: boring-avatars calls
// useId for its mask and the ImageResponse renderer has no hook dispatcher.
// So the beam SVG is rebuilt in beamface.tsx. These tests are the pin: the
// rebuilt markup has to stay identical to what the chart's own faces render,
// or a card stops showing the frens it claims to.
const ADDRESSES = [
  "0x4981053ac0000000000000000000000000000001",
  "0x073f475a00ec54172f38864b12b32e7f481607e9",
  "0xdeadbeef00000000000000000000000000000000",
  "0x0000000000000000000000000000000000000000",
  "0xffffffffffffffffffffffffffffffffffffffff",
  "0x1234567890abcdef1234567890abcdef12345678",
  "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
  "0x00000000000000000000000000000000000000ff",
];

// Everything a face is made of, with the mask id, the layout-only attributes
// and attribute order normalized away. This is the whole pin: any drift in
// seed, colour, geometry or path shows up as a different string.
function faceFacts(markup: string): string {
  const flat = markup
    .replace(/\s+/g, " ")
    .replace(/id="[^"]*"/g, 'id="M"')
    .replace(/url\(#[^)]*\)/g, "url(#M)");
  return flat
    .split(/(?=<)/)
    .map((chunk) => {
      const tag = /^<([a-zA-Z]+)([^>]*?)\/?>/.exec(chunk);
      if (!tag) return "";
      const attrs = [...(tag[2] ?? "").matchAll(/([a-zA-Z-]+)="([^"]*)"/g)]
        .filter((a) => a[1] !== "style" && a[1] !== "role")
        .map((a) => `${a[1]}=${a[2]}`)
        .sort();
      return `<${tag[1]} ${attrs.join(" ")}>`;
    })
    .join("");
}

describe("beamFace", () => {
  it("renders the same markup as boring-avatars for every address", () => {
    for (const address of ADDRESSES) {
      const mine = renderToStaticMarkup(<BeamFace name={address} id="beam" />);
      const theirs = renderToStaticMarkup(<Avatar size={36} name={address} variant="beam" />);
      expect(faceFacts(mine)).toBe(faceFacts(theirs));
    }
  });

  it("gives two traders different faces", () => {
    const a = beamFace(ADDRESSES[0] as string);
    const b = beamFace(ADDRESSES[1] as string);
    expect(`${a.background}${a.wrapper}${a.wrapperTransform}${a.faceTransform}`).not.toBe(
      `${b.background}${b.wrapper}${b.wrapperTransform}${b.faceTransform}`,
    );
  });

  it("seeds on the lowercased name, so an address never changes face", () => {
    const upper = ADDRESSES[0] as string;
    expect(beamFace(upper.toUpperCase().replace("0X", "0x"))).toEqual(beamFace(upper));
  });

  it("draws in the library's 36 unit box, clipped to a circle", () => {
    const f = beamFace(ADDRESSES[0] as string);
    expect(BEAM_BOX).toBe(36);
    expect(f.maskRadius).toBe(72);
    expect(f.wrapperRadius === BEAM_BOX || f.wrapperRadius === BEAM_BOX / 6).toBe(true);
    expect(f.background).toMatch(/^#[0-9A-F]{6}$/);
    expect(f.faceInk === "#000000" || f.faceInk === "#FFFFFF").toBe(true);
  });
});
