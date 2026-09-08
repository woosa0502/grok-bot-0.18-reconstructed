import type { CSSProperties } from "react";

const codepoints = {
  plus: 0xf3e5,
  display: 0xf3a8,
  back: 0xf389,
  chevronRight: 0xf38b,
  check: 0xf385,
  person: 0xf3df,
  trash: 0xf403,
  bell: 0xeaa2,
  creditCard: 0xf39a,
  globe: 0xf3c1,
  plug: 0xf3e3,
  sliders: 0xf3f0,
  search: 0xf3d5,
  mic: 0xf3d7,
  paperclip: 0xec54,
  signOut: 0xf13e,
  settings: 0xf3f0,
  palette: 0xf4b8,
  sparkle: 0xf3f4,
  more: 0xea7c,
  keyboard: 0xf3c8,
  close: 0xf409,
  warning: 0xea6c,
  send: 0xf3dd,
  bot: 0xf3e8,
  account: 0xeb99,
  archive: 0xea98,
  clock: 0xf391,
  copy: 0xf399,
  edit: 0xea73,
  eye: 0xf3ac,
  feedback: 0xf37f,
  file: 0xf3ad,
  folder: 0xf3b2,
  group: 0xea7e,
  haptics: 0xf2e9,
  help: 0xf2e5,
  image: 0xf3c5,
  language: 0xf3c1,
  model: 0xed87,
  refresh: 0xeb37,
  reply: 0xebea,
  report: 0xeb42,
  routine: 0xebb1,
  smile: 0xf3f1,
  subscription: 0xf39a,
  template: 0xf414,
  tools: 0xf3f4,
  usage: 0xeb03,
} as const;

export type IconName = keyof typeof codepoints;

export function Icon({ name, size = 20, className = "", style, label }: { name: IconName; size?: number; className?: string; style?: CSSProperties; label?: string }) {
  return (
    <span aria-hidden={label ? undefined : true} aria-label={label} className={`cursor-icon ${className}`} style={{ fontSize: size, ...style }}>
      {String.fromCodePoint(codepoints[name])}
    </span>
  );
}
