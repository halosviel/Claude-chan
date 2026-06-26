#!/usr/bin/env python3
# ===========================================================================
#  server.py
#
#  Entry point for the Claude-chan server. The implementation lives in the app/
#  package (config, images, voice, chat, server); this file just starts it, so
#  python3 server.py and VS Code F5 keep working unchanged.
# ===========================================================================

from app.server import main


if __name__ == "__main__":
    main()
