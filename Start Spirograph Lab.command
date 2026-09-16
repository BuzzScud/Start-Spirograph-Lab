#!/bin/zsh
# Double-click to start the Spirograph Lab and open it in the browser. Close this window to stop it.
cd "${0:A:h}/spirograph-lab" || exit 1
if lsof -iTCP:17480 -sTCP:LISTEN >/dev/null 2>&1; then open http://127.0.0.1:17480; exit 0; fi
exec node --disable-warning=ExperimentalWarning server/server.mjs --open
