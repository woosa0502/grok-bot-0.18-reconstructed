#!/usr/bin/env bash
cd /home/hoon/chromium/src
echo "[build] start $(date)"
# 트리의 ninja 직접 사용 (depot_tools python 우회). 8코어.
./third_party/ninja/ninja -C out/aside chrome -j8 2>&1
echo "[build] ninja-exit=${PIPESTATUS[0]} $(date)"
