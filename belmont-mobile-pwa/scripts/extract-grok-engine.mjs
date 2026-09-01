import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/home/hoon/_roots/labs/work/Belmont/package.json");
const acorn = require("acorn");
const src = readFileSync("/home/hoon/_roots/labs/work/Belmont/.build/belmont-wsl-runtime/dist/renderer/assets/index-UbX-y3il.js", "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });

// 문장별 정의/참조 심볼 수집
const defs = new Map();      // name -> stmt index
const refsPer = [];          // stmt index -> Set(names)
const collectPattern = (pat, idx) => {
  if (!pat) return;
  if (pat.type === "Identifier") { if (!defs.has(pat.name)) defs.set(pat.name, idx); }
  else if (pat.type === "ObjectPattern") pat.properties.forEach((p) => collectPattern(p.value ?? p.argument, idx));
  else if (pat.type === "ArrayPattern") pat.elements.forEach((el) => el && collectPattern(el, idx));
  else if (pat.type === "AssignmentPattern") collectPattern(pat.left, idx);
  else if (pat.type === "RestElement") collectPattern(pat.argument, idx);
};
const walk = (node, out) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return; }
  if (typeof node.type !== "string") return;
  if (node.type === "Identifier") { out.add(node.name); return; }
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end") continue;
    if (node.type === "MemberExpression" && key === "property" && !node.computed) continue;
    if (node.type === "Property" && key === "key" && !node.computed) continue;
    if ((node.type === "MethodDefinition" || node.type === "PropertyDefinition") && key === "key" && !node.computed) continue;
    walk(node[key], out);
  }
};
ast.body.forEach((node, idx) => {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") defs.set(node.id.name, idx) ;
  else if (node.type === "VariableDeclaration") node.declarations.forEach((d) => collectPattern(d.id, idx));
  const refs = new Set();
  walk(node, refs);
  refsPer.push(refs);
});

// createRoot 정의 문장 찾기 (react-dom/client)
let createRootStmt = -1;
ast.body.forEach((node, idx) => {
  if (createRootStmt >= 0) return;
  const segment = src.slice(node.start, Math.min(node.end, node.start + 200000));
  if (/createRoot[:=]/.test(segment) && segment.includes("Target container is not a DOM element")) createRootStmt = idx;
});
console.log("createRoot 문장:", createRootStmt);

// BFS 폐포
const seeds = ["sd", "Nlt", "$_t", "gAt"];
const include = new Set();
const queue = seeds.map((s) => defs.get(s)).filter((v) => v != null);
if (createRootStmt >= 0) queue.push(createRootStmt);
while (queue.length) {
  const idx = queue.pop();
  if (include.has(idx)) continue;
  include.add(idx);
  for (const name of refsPer[idx]) {
    const at = defs.get(name);
    if (at != null && !include.has(at)) queue.push(at);
  }
}
const ordered = [...include].sort((a, b) => a - b);
let total = 0;
for (const idx of ordered) total += ast.body[idx].end - ast.body[idx].start;
console.log("포함 문장:", ordered.length, "/", ast.body.length, "| 크기:", Math.round(total / 1024), "KB");

// createRoot 심볼명 알아내기: 해당 문장이 정의하는 이름 중 검사
let domVar = null;
if (createRootStmt >= 0) {
  for (const [name, at] of defs) if (at === createRootStmt) { domVar = name; break; }
}
console.log("react-dom 모듈 심볼:", domVar);

const parts = ordered.map((idx) => src.slice(ast.body[idx].start, ast.body[idx].end));
const epilogue = `
;export { sd as GrokMark, Nlt as GrokMirror, $_t as GrokEngine, S as EngineReact };
export function mountGrokMark(el, props) {
  const root = gAt.createRoot(el);
  root.render(S.createElement(sd, props));
  return root;
}
window.__grokEngine = { mountGrokMark };
`;
writeFileSync(process.argv[2], parts.join("\n") + epilogue);
console.log("저장 완료");
