import Avatar from "boring-avatars";
import { FACE_OUTLINE, FACE_RING_PX, FACE_SIZE, ringColorFor, type Side } from "@/lib/faces";

/// One fren on the chart: a 28px boring-avatars "beam" circle seeded by the
/// lowercased address, with a 2px ring in the side colour (green long, red
/// short) and a 2px page-colour outline so overlaps read as a stack.
export function Face({
  address,
  side,
  size = FACE_SIZE,
  dim = false,
}: {
  address: string;
  side: Side;
  size?: number;
  dim?: boolean;
}) {
  const inner = Math.max(1, size - FACE_RING_PX * 2);
  return (
    <span
      className="block rounded-full"
      style={{
        width: size,
        height: size,
        padding: FACE_RING_PX,
        background: ringColorFor(side),
        boxShadow: `0 0 0 2px ${FACE_OUTLINE}`,
        opacity: dim ? 0.35 : 1,
      }}
    >
      <span className="block h-full w-full overflow-hidden rounded-full">
        <Avatar size={inner} name={address.toLowerCase()} variant="beam" />
      </span>
    </span>
  );
}
