/** Buffer operations used by installed Moonlight Web 2.10 WebSocket channels. */
type ChannelBuffer = {
  buffer?: Uint8Array;
  reset: () => void;
  putU8: (value: number) => void;
  putU8Array: (value: Uint8Array) => void;
  flip: () => void;
  getU8: () => number;
  getRemainingBuffer: () => Uint8Array;
};
type Channel = { id: number; buffer: ChannelBuffer; receiveListeners: unknown[] };
export type WindowsTransport = {
  implementationName?: string;
  channels?: Channel[];
  buffer?: ChannelBuffer;
  belmontReceive?: { version: 1; headerReads: number; payloadCopies: number; payloadBytes: number };
};

/** Pinned instance boundary: existing bound listeners keep their dispatch order.
 * Each gets a lazy reader instead of copying a video packet into the shared buffer27 times.
 * Only the matching channel materializes its payload; outgoing serialization is unchanged.
 * Malformed packets still reject, but diagnostic exception types/messages can differ.
 */
export function streamlineWindowsTransport(transport: WindowsTransport | null | undefined): boolean {
  if (transport?.belmontReceive?.version === 1) return true;
  if (transport?.implementationName !== "web_socket" || !Array.isArray(transport.channels)
    || transport.channels.length !== 27 || !transport.buffer) return false;
  const original = transport.buffer;
  if (!["reset", "putU8", "putU8Array", "flip", "getU8", "getRemainingBuffer"]
    .every((key) => typeof original[key as keyof ChannelBuffer] === "function")
    || transport.channels.some((channel, index) => !channel || channel.id !== index
      || channel.buffer !== original || !Array.isArray(channel.receiveListeners))) return false;

  const stats = { version: 1 as const, headerReads: 0, payloadCopies: 0, payloadBytes: 0 };
  for (const channel of transport.channels) {
    let bytes: Uint8Array | null = null;
    let position = 0;
    let writing = false;
    channel.buffer = {
      reset() { bytes = null; position = 0; writing = false; },
      putU8(value) {
        if (!writing) { original.reset(); writing = true; }
        original.putU8(value);
      },
      putU8Array(value) {
        if (writing) original.putU8Array(value);
        else {
          if (original.buffer && value.byteLength > original.buffer.byteLength) throw new RangeError("WebSocket packet exceeds channel buffer capacity");
          bytes = value;
        }
      },
      flip() { if (writing) original.flip(); else position = 0; },
      getU8() {
        if (writing) return original.getU8();
        if (!bytes || position >= bytes.byteLength) throw new RangeError("Missing WebSocket channel header");
        stats.headerReads += 1;
        const id = bytes[position++]!;
        if (id !== channel.id) bytes = null;
        return id;
      },
      getRemainingBuffer() {
        if (writing) return original.getRemainingBuffer();
        // Match upstream ownership: listeners receive an independent exact-length buffer.
        const payload = bytes!.slice(position);
        stats.payloadCopies += 1;
        stats.payloadBytes += payload.byteLength;
        bytes = null;
        return payload;
      },
    };
  }
  transport.belmontReceive = stats;
  return true;
}
