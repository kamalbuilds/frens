// Renders the room's real beam faces (same geometry and seed as the chart) to video/scenes/faces.js for the title scenes.
import fs from "node:fs";
import { BEAM_BOX, beamFace } from "../web/lib/beamface";

const frens: Record<string, string> = {
  ana: "0xb3790F7EBa6bd875714bBeD7e3f9F303871F0CCC",
  bo: "0x91427a5de167E2Fc7693Ce4F0f0784A5695b6244",
  cy: "0x4eb664F1E9b7c812ddfbc4118326fe3e23b7dced",
  dee: "0x073f475a00ec54172f38864b12b32e7f481607e9",
};
const out: Record<string, string> = {};
for (const [n, a] of Object.entries(frens)) {
  const f = beamFace(a);
  const id = `m-${n}`;
  out[n] = `<svg viewBox="0 0 ${BEAM_BOX} ${BEAM_BOX}" fill="none" xmlns="http://www.w3.org/2000/svg"><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${BEAM_BOX}" height="${BEAM_BOX}"><rect width="${BEAM_BOX}" height="${BEAM_BOX}" rx="${f.maskRadius}" fill="#fff"/></mask><g mask="url(#${id})"><rect width="${BEAM_BOX}" height="${BEAM_BOX}" fill="${f.background}"/><rect width="${BEAM_BOX}" height="${BEAM_BOX}" rx="${f.wrapperRadius}" transform="${f.wrapperTransform}" fill="${f.wrapper}"/><g transform="${f.faceTransform}">${f.mouthOpen ? `<path d="${f.mouthPath}" stroke="${f.faceInk}" fill="none" stroke-linecap="round"/>` : `<path d="${f.mouthPath}" fill="${f.faceInk}"/>`}<rect x="${f.eyeLeft}" y="14" width="1.5" height="2" rx="1" fill="${f.faceInk}"/><rect x="${f.eyeRight}" y="14" width="1.5" height="2" rx="1" fill="${f.faceInk}"/></g></g></svg>`;
}
fs.writeFileSync(new URL("./scenes/faces.js", import.meta.url), `window.FACES=${JSON.stringify(out)};\n`);
console.log(Object.keys(out).join(","));
