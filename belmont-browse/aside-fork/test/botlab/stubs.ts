import { join } from "node:path";
const ROOT = process.env.BOTLAB_ROOT ?? process.cwd();
export function getSandAgentsRootDir(): string { return join(ROOT, "agents"); }
export function getSandRootDir(): string { return ROOT; }
