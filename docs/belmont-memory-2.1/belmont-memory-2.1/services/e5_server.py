#!/usr/bin/env python3
"""Real local multilingual E5 inference. No model weights are bundled or fabricated.
Install services/requirements.txt, pin BELMONT_EMBED_REVISION, then run this file.
"""
import json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from transformers import AutoModel, AutoTokenizer
MODEL = os.environ.get("BELMONT_EMBED_MODEL", "intfloat/multilingual-e5-small")
REVISION = os.environ.get("BELMONT_EMBED_REVISION", "")
if not REVISION or REVISION == "main":
    raise SystemExit("Set BELMONT_EMBED_REVISION to an immutable Hugging Face commit SHA.")
TOKEN = os.environ.get("BELMONT_EMBED_TOKEN", "")
torch.set_num_threads(int(os.environ.get("BELMONT_EMBED_THREADS", "4")))
tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, trust_remote_code=False)
model = AutoModel.from_pretrained(MODEL, revision=REVISION, trust_remote_code=False, use_safetensors=True).eval()
identity = {"model": MODEL, "revision": REVISION, "dimension": model.config.hidden_size, "recipe": "e5-prefix-mean-l2-512-v1"}
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass  # Do not log personal query text.
    def do_POST(self):
        try:
            if self.path != "/embed": return self.send_error(404)
            if TOKEN and self.headers.get("Authorization") != "Bearer " + TOKEN: return self.send_error(401)
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2_000_000: return self.send_error(413)
            request = json.loads(self.rfile.read(length))
            if request.get("identity") != identity: return self.send_error(409, "identity mismatch")
            texts, purpose = request["texts"], request["purpose"]
            if purpose not in ("query", "passage") or not 1 <= len(texts) <= 64 or any(not isinstance(t,str) or len(t)>64000 for t in texts): return self.send_error(400)
            with lock, torch.inference_mode():
                encoded = tokenizer([purpose + ": " + t for t in texts], max_length=512, truncation=True, padding=True, return_tensors="pt")
                outputs = model(**encoded).last_hidden_state
                mask = encoded["attention_mask"].unsqueeze(-1)
                pooled = (outputs * mask).sum(1) / mask.sum(1).clamp(min=1)
                vectors = torch.nn.functional.normalize(pooled, p=2, dim=1).cpu().tolist()
            payload=json.dumps({"identity": identity, "embeddings": vectors}, separators=(",", ":")).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(payload))); self.end_headers(); self.wfile.write(payload)
        except (ValueError, KeyError, TypeError): self.send_error(400)
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception: self.send_error(500, "embedding failure")
if __name__ == "__main__":
    print(json.dumps({"status":"ready", "identity":identity}), flush=True)
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("BELMONT_EMBED_PORT","8765"))), Handler).serve_forever()
