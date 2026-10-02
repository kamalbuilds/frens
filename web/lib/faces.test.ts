import { describe, expect, it } from "bun:test";
import {
  CLUSTER_MAX_FACES,
  CLUSTER_OVERLAP_PX,
  CLUSTER_RADIUS_PX,
  FACE_SIZE,
  LONG_RING,
  SHORT_RING,
  clusterFaces,
  ringColorFor,
  type FacePoint,
} from "./faces";

const pt = (account: string, x: number, y: number, side: "long" | "short" = "long"): FacePoint => ({
  account,
  x,
  y,
  side,
});

describe("ringColorFor", () => {
  it("rings long green and short red", () => {
    expect(ringColorFor("long")).toBe(LONG_RING);
    expect(ringColorFor("short")).toBe(SHORT_RING);
  });
  it("uses the spec hexes directly, no color-mix", () => {
    expect(LONG_RING).toBe("#2BD67B");
    expect(SHORT_RING).toBe("#FF6B57");
  });
  it("faces are 28px circles", () => {
    expect(FACE_SIZE).toBe(28);
  });
});

describe("clusterFaces", () => {
  it("keeps distant faces in their own clusters", () => {
    const clusters = clusterFaces([pt("0xaaa", 100, 100), pt("0xbbb", 300, 100)]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].collapsed).toBe(false);
    expect(clusters[0].overflowLabel).toBeNull();
  });
  it("groups faces within 14px into one cluster with a -10px overlap offset", () => {
    const clusters = clusterFaces([pt("0xaaa", 100, 100), pt("0xbbb", 108, 104)]);
    expect(CLUSTER_RADIUS_PX).toBe(14);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.account)).toEqual(["0xaaa", "0xbbb"]);
    expect(clusters[0].members[0].dx).toBe(0);
    expect(clusters[0].members[1].dx).toBe(-CLUSTER_OVERLAP_PX);
    expect(CLUSTER_OVERLAP_PX).toBe(24);
  });
  it("groups a run of faces around one anchor", () => {
    const clusters = clusterFaces([pt("0xa", 100, 100), pt("0xb", 108, 100), pt("0xc", 112, 100)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.dx)).toEqual([0, -24, -48]);
  });
  it("starts a new cluster past the anchor radius", () => {
    const clusters = clusterFaces([pt("0xa", 100, 100), pt("0xb", 108, 100), pt("0xc", 130, 100)]);
    expect(clusters).toHaveLength(2);
    expect(clusters[1].members.map((m) => m.account)).toEqual(["0xc"]);
  });
  it("does not collapse a cluster of exactly 5", () => {
    const points = Array.from({ length: 5 }, (_, i) => pt(`0x${i}`, 100 + i * 2, 100));
    const clusters = clusterFaces(points);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].collapsed).toBe(false);
    expect(clusters[0].overflowLabel).toBeNull();
  });
  it("collapses more than 5 faces into a +N circle", () => {
    expect(CLUSTER_MAX_FACES).toBe(5);
    const points = Array.from({ length: 7 }, (_, i) => pt(`0x${i}`, 100 + i, 100));
    const clusters = clusterFaces(points);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].collapsed).toBe(true);
    expect(clusters[0].overflowLabel).toBe("+7");
  });
  it("rejects a nonsense radius instead of misclustering", () => {
    expect(() => clusterFaces([pt("0xaaa", 0, 0)], -1)).toThrow(/radius/);
    expect(() => clusterFaces([pt("0xaaa", 0, 0)], NaN)).toThrow(/radius/);
  });
  it("returns no clusters for no faces", () => {
    expect(clusterFaces([])).toEqual([]);
  });
});
