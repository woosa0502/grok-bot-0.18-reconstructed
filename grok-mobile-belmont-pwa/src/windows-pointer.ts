export type RelativePointerTarget = {
  streamerSize?: readonly number[] | null;
  mouseRelative?: { send: (buffer: ArrayBuffer) => void } | null;
  sendMouseMove?: (x: number, y: number) => void;
};

/** Keep fractional HOST pixels, not a queue of delayed mouse events. */
export function createRelativePointer() {
  let target: RelativePointerTarget | null = null;
  let channel: RelativePointerTarget["mouseRelative"] = null;
  let scaleX = 0;
  let scaleY = 0;
  let geometry = "";
  let remainderX = 0;
  let remainderY = 0;

  function reset() {
    target = null;
    channel = null;
    remainderX = remainderY = 0;
    scaleX = scaleY = 0;
    geometry = "";
  }

  return {
    reset,
    move(input: RelativePointerTarget, dx: number, dy: number, rect: { width: number; height: number }, sensitivity: number) {
      const width = input.streamerSize?.[0];
      const height = input.streamerSize?.[1];
      if (!input.sendMouseMove || !input.mouseRelative || typeof input.mouseRelative.send !== "function"
        || ![dx, dy, rect.width, rect.height, sensitivity, width, height].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0 || sensitivity <= 0 || width! <= 0 || height! <= 0) {
        reset();
        return false;
      }
      const nextX = width! / rect.width * sensitivity;
      const nextY = height! / rect.height * sensitivity;
      const nextGeometry = `${width},${height},${rect.width},${rect.height}`;
      if (target !== input || channel !== input.mouseRelative || geometry !== nextGeometry || scaleX !== nextX || scaleY !== nextY) reset();
      target = input;
      channel = input.mouseRelative;
      geometry = nextGeometry;
      scaleX = nextX;
      scaleY = nextY;
      const totalX = remainderX + dx * scaleX;
      const totalY = remainderY + dy * scaleY;
      const x = Math.round(totalX);
      const y = Math.round(totalY);
      // Invalid/outlier events must not wrap signed16-bit coordinates or queue a later jump.
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -32768 || x > 32767 || y < -32768 || y > 32767) {
        reset();
        return false;
      }
      try {
        if (x !== 0 || y !== 0) input.sendMouseMove(x, y);
        remainderX = totalX - x;
        remainderY = totalY - y;
        return true;
      } catch {
        reset();
        return false;
      }
    },
  };
}
