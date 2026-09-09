// installation-keys.json(JWK) → PKCS#8 DER 키 파일. 포크는 ASIDE_INSTALLATION_KEY 로 이 파일을 읽어 데몬 인증에 서명한다.
// 사용: node make-installation-key.mjs <installation-keys.json> <출력 키 파일>
import { createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const [src, out] = process.argv.slice(2);
const keys = JSON.parse(readFileSync(src, "utf8"));
const der = createPrivateKey({ key: keys.privateJwk, format: "jwk" }).export({ type: "pkcs8", format: "der" });
writeFileSync(out, der);
console.log(`wrote ${der.length}-byte PKCS#8 DER to ${out}`);
