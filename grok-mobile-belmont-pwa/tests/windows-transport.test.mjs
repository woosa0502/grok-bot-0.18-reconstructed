import assert from "node:assert/strict";
import test from "node:test";
import { streamlineWindowsTransport } from "../src/windows-transport.ts";

function setup() {
  let bytes = [], position = 0, copied = 0;
  const buffer = {
    reset() { bytes = []; position = 0; },
    putU8(n) { bytes.push(n); },
    putU8Array(value) { copied += value.length; bytes.push(...value); },
    flip() { position = 0; },
    getU8() { return bytes[position++]; },
    getRemainingBuffer() { return Uint8Array.from(bytes.slice(position)); },
  };
  const transport = { implementationName: "web_socket", buffer, channels: Array.from({ length: 27 }, (_, id) => ({ id, buffer, receiveListeners: [] })) };
  const dispatch = (message) => {
    // Pinned upstream handler sequence, tested against actual installed class independently.
    for (const channel of transport.channels) {
      channel.buffer.reset(); channel.buffer.putU8Array(message); channel.buffer.flip();
      if (channel.buffer.getU8() !== channel.id) continue;
      const payload = channel.buffer.getRemainingBuffer();
      for (const listener of channel.receiveListeners) listener(payload);
    }
  };
  const send = (id, payload) => {
    const b = transport.channels[id].buffer;
    b.reset(); b.putU8(id); b.putU8Array(payload); b.flip();
    return Array.from(b.getRemainingBuffer());
  };
  return { transport, dispatch, send, copied: () => copied };
}

test("all channels preserve exact independent payloads without unrelated full-packet copies", () => {
  const s = setup(), seen = [];
  s.transport.channels.forEach(c => c.receiveListeners.push(bytes => seen.push([c.id, bytes])));
  assert.equal(streamlineWindowsTransport(s.transport), true);
  for (let id = 0; id < 27; id++) {
    const bytes = Uint8Array.of(id, id, 255, 0);
    s.dispatch(bytes); bytes.fill(99);
  }
  assert.deepEqual(seen.map(([id,b]) => [id,Array.from(b)]), Array.from({length:27}, (_,id)=>[id,[id,255,0]]));
  assert.equal(s.copied(), 0);
  assert.equal(s.transport.belmontReceive.headerReads, 27 * 27);
  assert.equal(s.transport.belmontReceive.payloadCopies, 27);
  assert.equal(s.transport.belmontReceive.payloadBytes, 81);
});

test("outgoing channel prefix and synchronous RTT-like echo are unchanged", () => {
  const s = setup(); streamlineWindowsTransport(s.transport);
  let echo;
  s.transport.channels[26].receiveListeners.push(bytes => { echo = s.send(26, bytes); });
  s.dispatch(Uint8Array.of(26,1,2,3,4));
  assert.deepEqual(echo,[26,1,2,3,4]);
  for (let id=0;id<27;id++) assert.deepEqual(s.send(id,Uint8Array.of(0,255)),[id,0,255]);
});

test("nested receive and listener order preserve independent payload ownership", () => {
  const s = setup(), seen = []; streamlineWindowsTransport(s.transport);
  s.transport.channels[2].receiveListeners.push(bytes => {
    seen.push(Array.from(bytes));
    if (bytes[0] === 1) s.dispatch(Uint8Array.of(2,2));
  }, bytes => seen.push(Array.from(bytes)));
  s.dispatch(Uint8Array.of(2,1));
  assert.deepEqual(seen,[[1],[2],[2],[1]]);
});

test("empty payload, unknown channel, idempotence and changed transport guards", () => {
  const s = setup(), seen=[]; streamlineWindowsTransport(s.transport);
  const original=s.transport.channels[0].buffer;
  assert.equal(streamlineWindowsTransport(s.transport),true);
  assert.equal(s.transport.channels[0].buffer,original);
  s.transport.channels[0].receiveListeners.push(bytes=>seen.push(Array.from(bytes)));
  s.dispatch(Uint8Array.of(0)); s.dispatch(Uint8Array.of(255,1));
  assert.deepEqual(seen,[[]]);
  for (const transport of [null,{}, {implementationName:"webrtc"}, {...setup().transport,channels:[]}]) {
    assert.equal(streamlineWindowsTransport(transport),false);
  }
});
