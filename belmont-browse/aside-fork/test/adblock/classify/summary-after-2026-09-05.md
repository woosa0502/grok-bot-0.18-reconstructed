## easylist: url ok 56827, style ok 24544, rejected 0

| rejected reason | lines |
|---|---|

### UNKNOWN_OPTION by option (first failing option only)

| option | lines |
|---|---|

### all options appearing on rejected network lines

| option | lines |
|---|---|

### cosmetic rejections by feature

| feature | lines |
|---|---|

### other rejections (reason, token)

| reason | token | lines |
|---|---|---|

### accepted but semantically different

- regex-pattern rules (`/…/`) indexed as literal text: **24**
  - `/(https?:\/\/)\w{30,}\.me\/\w{30,}\./$script,third-party`
  - `/(https?:\/\/)104\.154\..{100,}/`
  - `/(https?:\/\/)104\.197\..{100,}/`
  - `/(https?:\/\/)104\.198\..{100,}/`
  - `/(https?:\/\/)130\.211\..{100,}/`
  - `/(https?:\/\/)142\.91\.159\..{100,}/`
  - `/(https?:\/\/)213\.32\.115\..{100,}/`
  - `/(https?:\/\/)216\.21\..{100,}/`

## easyprivacy: url ok 55996, style ok 35, rejected 1

| rejected reason | lines |
|---|---|
| NOT_A_TRISTATE_OPTION | 1 |

### UNKNOWN_OPTION by option (first failing option only)

| option | lines |
|---|---|

### all options appearing on rejected network lines

| option | lines |
|---|---|
| `~subdocument` | 1 |
| `~document` | 1 |
| `domain` | 1 |

### cosmetic rejections by feature

| feature | lines |
|---|---|

### other rejections (reason, token)

| reason | token | lines |
|---|---|---|
| NOT_A_TRISTATE_OPTION | `document` | 1 |

### accepted but semantically different

- regex-pattern rules (`/…/`) indexed as literal text: **7**
  - `/^https:\/\/cdn\.jsdelivr\.net\/npm\/[-a-z_]{4,22}@latest\/dist\/script\.min\.js$/$script,third-part`
  - `/^https?:\/\/fdts\.ebay-kleinanzeigen\.de\/[a-z0-9]{13,18}\.js\?/$script,domain=kleinanzeigen.de`
  - `/^https?:\/\/pov\.spectrum\.net\/[a-zA-Z0-9]{14,}\.js/$script,domain=spectrum.net`
  - `/^https?:\/\/tjmaxx\.tjx\.com\/libraries\/[a-z0-9]{20,}/$script,xmlhttprequest,domain=tjx.com`
  - `/^https?:\/\/tmx\.(td|tdbank)\.com\/[a-z0-9]{14,18}\.js.*/$script,domain=mbna.ca|td.com|tdbank.com`
  - `/^https?:\/\/www\.ebay-kleinanzeigen\.de\/[a-z0-9]{8}\-[0-9a-f]{4}\-/$script,domain=kleinanzeigen.de`
  - `/^https?:\/\/www\.kroger\.com\/content\/{20,}/$script,xmlhttprequest,domain=kroger.com`

