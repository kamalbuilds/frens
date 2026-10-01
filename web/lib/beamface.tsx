/// One fren's face: the boring-avatars "beam" circle, rebuilt for the share
/// card. The library's own component calls React's useId for the mask, which
/// the ImageResponse renderer has no dispatcher for, so the SVG is built here
/// instead. Same seed, same palette, same geometry, so a card face is the
/// face the room shows on the chart: beamface.test.tsx pins this rendering
/// against boring-avatars' own output for a spread of addresses.
import type { Address } from "viem";

/// boring-avatars' beam variant draws in a 36 unit square.
export const BEAM_BOX = 36;

/// boring-avatars' default palette.
export const BEAM_COLORS = ["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"] as const;

const HALF = BEAM_BOX / 2;
const NUDGE = BEAM_BOX / 9;
const MAX_SHIFT = 5;
const FACE_SPLIT = BEAM_BOX / 6;

/// boring-avatars' 32-bit string hash, the seed every other choice reads.
function seedFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h << 5) - h + name.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h);
}

/// The nth decimal digit of the seed.
function digitAt(seed: number, n: number): number {
  return Math.floor(seed / 10 ** n) % 10;
}

const isEvenDigit = (seed: number, n: number): boolean => digitAt(seed, n) % 2 === 0;

/// seed mod value, negated when digit n is even. The sign flip is what keeps
/// the two axes from moving together.
function unit(seed: number, value: number, digit?: number): number {
  const abs = seed % value;
  return digit !== undefined && isEvenDigit(seed, digit) ? -abs : abs;
}

const colorAt = (seed: number, colors: readonly string[]): string => colors[seed % colors.length] as string;

/// Black or white face lines, whichever reads on the wrapper colour.
function inkOn(color: string): string {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1e3 >= 128 ? "#000000" : "#FFFFFF";
}

export type BeamFace = {
  /// The circle mask, wide enough to clip the corners off.
  maskRadius: number;
  background: string;
  wrapper: string;
  wrapperRadius: number;
  wrapperTransform: string;
  faceTransform: string;
  faceInk: string;
  mouthOpen: boolean;
  mouthPath: string;
  eyeLeft: number;
  eyeRight: number;
};

/// The beam geometry for one seed: a coloured ground, a rounded wrapper block
/// rotated and scaled off centre, and the eyes and mouth on top.
function faceFor(seed: number, colors: readonly string[]): BeamFace {
  const wrapper = colorAt(seed, colors);
  const shiftX = unit(seed, 10, 1);
  const shiftY = unit(seed, 10, 2);
  const nudgeX = shiftX < MAX_SHIFT ? shiftX + NUDGE : shiftX;
  const nudgeY = shiftY < MAX_SHIFT ? shiftY + NUDGE : shiftY;
  const rotate = unit(seed, 360);
  const scale = 1 + unit(seed, BEAM_BOX / 12) / 10;
  const eyeSpread = unit(seed, 5);
  const mouthSpread = unit(seed, 3);
  return {
    maskRadius: BEAM_BOX * 2,
    background: colorAt(seed + 13, colors),
    wrapper,
    wrapperRadius: isEvenDigit(seed, 1) ? BEAM_BOX : BEAM_BOX / 6,
    wrapperTransform: `translate(${nudgeX} ${nudgeY}) rotate(${rotate} ${HALF} ${HALF}) scale(${scale})`,
    faceTransform: `translate(${nudgeX > FACE_SPLIT ? nudgeX / 2 : unit(seed, 8, 1)} ${
      nudgeY > FACE_SPLIT ? nudgeY / 2 : unit(seed, 7, 2)
    }) rotate(${unit(seed, 10, 3)} ${HALF} ${HALF})`,
    faceInk: inkOn(wrapper),
    mouthOpen: isEvenDigit(seed, 2),
    mouthPath: isEvenDigit(seed, 2) ? `M15 ${19 + mouthSpread}c2 1 4 1 6 0` : `M13,${19 + mouthSpread} a1,0.75 0 0,0 10,0`,
    eyeLeft: 14 - eyeSpread,
    eyeRight: 20 + eyeSpread,
  };
}

/// The face a name gets. Addresses seed by their lowercased 0x form, which is
/// what the chart passes, so the same trader never changes face.
export function beamFace(name: string, colors: readonly string[] = BEAM_COLORS): BeamFace {
  return faceFor(seedFor(String(name).toLowerCase()), colors);
}

/// BeamFace rendered as inline SVG. `id` must be unique per card: satori and
/// the browser both key the circular clip on it.
export function BeamFace({ name, id, size = 36, colors = BEAM_COLORS }: { name: string | Address; id: string; size?: number; colors?: readonly string[] }) {
  const f = beamFace(name, colors);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BEAM_BOX} ${BEAM_BOX}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "flex", flexShrink: 0 }}
    >
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={BEAM_BOX} height={BEAM_BOX}>
        <rect width={BEAM_BOX} height={BEAM_BOX} rx={f.maskRadius} fill="#FFFFFF" />
      </mask>
      <g mask={`url(#${id})`}>
        <rect width={BEAM_BOX} height={BEAM_BOX} fill={f.background} />
        <rect
          x={0}
          y={0}
          width={BEAM_BOX}
          height={BEAM_BOX}
          rx={f.wrapperRadius}
          transform={f.wrapperTransform}
          fill={f.wrapper}
        />
        <g transform={f.faceTransform}>
          {f.mouthOpen ? (
            <path d={f.mouthPath} stroke={f.faceInk} fill="none" strokeLinecap="round" />
          ) : (
            <path d={f.mouthPath} fill={f.faceInk} />
          )}
          <rect x={f.eyeLeft} y={14} width={1.5} height={2} rx={1} stroke="none" fill={f.faceInk} />
          <rect x={f.eyeRight} y={14} width={1.5} height={2} rx={1} stroke="none" fill={f.faceInk} />
        </g>
      </g>
    </svg>
  );
}
