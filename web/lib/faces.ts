/// Fren faces on the chart: pure placement logic, kept apart from React and
/// the chart library so it can be unit tested.
///
/// Every fren is a 28px boring-avatars "beam" circle at their entry, ringed
/// 2px green for long or red for short. Faces whose centres land within 14px
/// of each other form one cluster: members step -24px in x each (4px overlap)
/// and every face carries a 2px page-colour outline so the stack reads.
/// A cluster with more than 5 members collapses into a single "+N" circle.

export const FACE_SIZE = 28;
export const FACE_RING_PX = 2;
export const FACE_OUTLINE = "#0A0A0F";
export const CLUSTER_RADIUS_PX = 14;
/// Step between faces in one cluster: 24px on a 28px face leaves each face readable, overlapping 4px.
export const CLUSTER_OVERLAP_PX = 24;
/// More than this many faces in one cluster collapses into a "+N" circle.
export const CLUSTER_MAX_FACES = 5;

export const LONG_RING = "#2BD67B";
export const SHORT_RING = "#FF6B57";

export type Side = "long" | "short";

/// Ring colour for a fren face: green for long, red for short. Never a
/// personal hue and never the brand accent: the ring reads side at a glance.
export function ringColorFor(side: Side): string {
  return side === "long" ? LONG_RING : SHORT_RING;
}

export type FacePoint = {
  account: string;
  x: number;
  y: number;
  side: Side;
};

export type ClusterMember = FacePoint & { dx: number };

export type FaceCluster = {
  key: string;
  x: number;
  y: number;
  members: ClusterMember[];
  collapsed: boolean;
  overflowLabel: string | null;
};

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/// Group face centres into clusters: a point joins the first cluster (in
/// x order) whose anchor sits within `radius` px, else it starts a new one.
/// Members after the first render shifted left by the overlap step so the
/// stack overlaps instead of covering. Clusters over CLUSTER_MAX_FACES
/// collapse: the UI renders one "+N" circle for the whole cluster.
export function clusterFaces(points: FacePoint[], radius: number = CLUSTER_RADIUS_PX): FaceCluster[] {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError(`bad cluster radius ${String(radius)}`);
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const clusters: FaceCluster[] = [];
  for (const p of sorted) {
    const hit = clusters.find((c) => dist(p.x, p.y, c.x, c.y) <= radius);
    if (hit) {
      hit.members.push({ ...p, dx: -CLUSTER_OVERLAP_PX * hit.members.length });
    } else {
      clusters.push({ key: p.account, x: p.x, y: p.y, members: [{ ...p, dx: 0 }], collapsed: false, overflowLabel: null });
    }
  }
  for (const c of clusters) {
    if (c.members.length > CLUSTER_MAX_FACES) {
      c.collapsed = true;
      c.overflowLabel = `+${c.members.length}`;
    }
  }
  return clusters;
}
