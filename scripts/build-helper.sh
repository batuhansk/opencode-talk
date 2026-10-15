#!/bin/sh
# Builds the macOS helper as a universal binary with an embedded Info.plist
# (required for the microphone and speech recognition permission prompts).
set -e
cd "$(dirname "$0")/.."
mkdir -p bin
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13" helper/main.swift \
    -o "bin/helper-$arch" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker helper/Info.plist
done
lipo -create bin/helper-arm64 bin/helper-x86_64 -output bin/opencode-talk-helper
rm bin/helper-arm64 bin/helper-x86_64
codesign --force --sign - --identifier dev.opencode-talk.helper bin/opencode-talk-helper
echo "Built bin/opencode-talk-helper"
