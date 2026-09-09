#!/usr/bin/env bash
cd /home/hoon/chromium/src
echo "[build] incr start $(date)"
./third_party/ninja/ninja -C out/aside chrome -j8
echo "[build] ninja-exit=$? $(date)"
