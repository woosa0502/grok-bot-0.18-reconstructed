import assert from "node:assert/strict";
import test from "node:test";
import { PERSONA_SHAPE_PATHS, personaSvg, resolvePersonaColor, resolvePersonaShape } from "../src/persona.js";

test("persona shape and color stay deterministic per agent id", () => {
  const shape = resolvePersonaShape("40fb61e3-7d7c-470d-8735-7b94090ff515", null);
  const color = resolvePersonaColor("40fb61e3-7d7c-470d-8735-7b94090ff515", null);
  assert.equal(resolvePersonaShape("40fb61e3-7d7c-470d-8735-7b94090ff515", null), shape);
  assert.equal(resolvePersonaColor("40fb61e3-7d7c-470d-8735-7b94090ff515", null), color);
  assert.equal(resolvePersonaShape("agent", "hex"), "hex", "explicit shapes win");
  assert.equal(resolvePersonaColor("agent", "cyan"), "cyan", "explicit colors win");
});

test("busy personas morph through structurally identical jelly frames", () => {
  for (const shape of Object.keys(PERSONA_SHAPE_PATHS)) {
    const svg = personaSvg({ id: "agent", shape, status: "busy" });
    const values = /values="([^"]+)"/.exec(svg)?.[1];
    assert.ok(values, `${shape}: morph frames missing`);
    const frames = values.split(";");
    assert.equal(frames.length, 5, `${shape}: loop must return to its first frame`);
    assert.equal(frames[0], frames[4], `${shape}: loop must close`);
    const structure = (frame) => frame.replace(/-?\d*\.?\d+/g, "#");
    // SMIL can only interpolate d values with an identical command skeleton.
    for (const frame of frames) assert.equal(structure(frame), structure(frames[0]), `${shape}: frame structure diverged`);
  }
  const idle = personaSvg({ id: "agent", shape: "blob", status: "idle" });
  assert.equal(idle.includes("<animate"), false, "idle personas hold still");
});
