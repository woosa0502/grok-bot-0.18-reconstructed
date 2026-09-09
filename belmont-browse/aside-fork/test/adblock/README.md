# Ad-block replica verification (2026-09-05)

Run against the fork launched by `belmont-browse/run-fork.sh` (CDP on 127.0.0.1:9333):

```
cd test/adblock/page && python3 -m http.server 18777 --bind 127.0.0.1 &
SP=<dir for screenshots> node adblock-test.mjs
```

`adblock-test.mjs` drives chrome://aside-adblock through the ORIGINAL page's mojom
bindings (getState / testRule / saveCustomRules / setEnabled), loads `page/index.html`
(ad script, ad pixel, GTM/GA fetches, ad iframe, `.ADBox`/`.ADBAR` elements), opens
https://www.naver.com and counts ERR_BLOCKED_BY_CLIENT, saves a `$document` custom rule,
verifies the "Aside blocked this page" page and "Continue once", then disables and
re-enables the blocker. `result-2026-09-05.json` is the last passing run.
