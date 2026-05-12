#!/usr/bin/env bash
set -euo pipefail
echo "SiglaCast setup"
[ -f .env ] || cp .env.example .env
echo "Done"
