#!/usr/bin/env bash
# Builds a self-contained desktop app for the OS it runs on, then archives it into dist/.
#
#   usage: scripts/build-app.sh <version> <platform-name>
#   e.g.   scripts/build-app.sh 1.0.0 linux-x64
#
# jpackage can only build for the OS it runs on, so the release workflow runs this on
# Linux, Windows and macOS runners. The result bundles its own Java runtime: users need nothing installed.
set -euo pipefail

VERSION="${1:-1.0.0}"
PLATFORM="${2:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
APP_NAME="OganessonAI"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -rf build dist
mkdir -p build/classes build/input dist

echo "==> Compiling"
find src -name '*.java' > build/sources.txt
javac -d build/classes @build/sources.txt

echo "==> Packing jar (code + web UI)"
jar --create --file build/input/oganesson.jar --main-class com.oganesson.ai.Main \
    -C build/classes . -C src/main/resources .

echo "==> Creating app image with jpackage"
# -Doganesson.packaged=true makes the app keep its data in the user's profile folder.
# java.net.http is the HTTP client the proxy uses. jdk.crypto.ec provides the elliptic-curve TLS that Claude, OpenAI and
# the other providers negotiate. jpackage can miss it because nothing references it directly, and without it every
# HTTPS request to an online provider would fail in the packaged app only.
jpackage \
    --type app-image \
    --name "$APP_NAME" \
    --app-version "$VERSION" \
    --vendor "Oganesson" \
    --input build/input \
    --main-jar oganesson.jar \
    --main-class com.oganesson.ai.Main \
    --dest dist \
    --add-modules java.net.http,jdk.crypto.ec \
    --java-options "-Doganesson.packaged=true"

echo "==> Archiving"
case "$PLATFORM" in
  windows*)
    # PowerShell ships with every Windows runner, so no extra tools are needed.
    powershell.exe -NoProfile -Command "Compress-Archive -Path 'dist/$APP_NAME' -DestinationPath 'dist/$APP_NAME-$PLATFORM.zip'"
    rm -rf "dist/$APP_NAME"
    ;;
  macos*)
    # ditto keeps the .app's executable bits and symlinks, which a plain zip can drop.
    ditto -c -k --sequesterRsrc --keepParent "dist/$APP_NAME.app" "dist/$APP_NAME-$PLATFORM.zip"
    rm -rf "dist/$APP_NAME.app"
    ;;
  *)
    tar -czf "dist/$APP_NAME-$PLATFORM.tar.gz" -C dist "$APP_NAME"
    rm -rf "dist/$APP_NAME"
    ;;
esac

echo "==> Done"
ls -la dist
