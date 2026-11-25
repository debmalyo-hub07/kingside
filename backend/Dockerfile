# SPDX-License-Identifier: AGPL-3.0-or-later
# Multi-stage Node 24 + native Stockfish 19 container for Kingside Backend API (Render Free 512 MB safe).

FROM node:24-slim AS builder
WORKDIR /app

RUN corepack enable && (corepack prepare pnpm@12.14.0 --activate || npm install -g pnpm@12.14.0)

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY packages/chess-core/package.json ./packages/chess-core/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/uci/package.json ./packages/uci/

RUN pnpm install --frozen-lockfile --filter @kingside/backend...

COPY packages ./packages
COPY backend ./backend

RUN pnpm --filter @kingside/backend build

FROM node:24-slim AS runtime
WORKDIR /app

RUN set -eux; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates libstdc++6; \
  arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) \
      sf_url="https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz"; \
      sf_sha256="9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f"; \
      ;; \
    arm64) \
      sf_url="https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-arm64-universal.tar.gz"; \
      sf_sha256="fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01"; \
      ;; \
    *) \
      sf_url=""; \
      sf_sha256=""; \
      ;; \
  esac; \
  if [ -n "$sf_url" ]; then \
    apt-get install -y --no-install-recommends curl; \
    mkdir -p /tmp/sf/extract; \
    curl -fsSL --retry 3 --retry-delay 2 "$sf_url" -o /tmp/sf/stockfish.tar.gz; \
    echo "$sf_sha256  /tmp/sf/stockfish.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/sf/stockfish.tar.gz -C /tmp/sf/extract; \
    find /tmp/sf/extract -type f -name 'stockfish*' | while IFS= read -r f; do \
      if [ "$(od -An -tx1 -N4 "$f" | tr -d '[:space:]')" = "7f454c46" ]; then \
        install -m 0755 "$f" /usr/local/bin/stockfish; \
        break; \
      fi; \
    done; \
    test -x /usr/local/bin/stockfish; \
    rm -rf /tmp/sf; \
    apt-get purge -y --auto-remove curl; \
  else \
    apt-get install -y --no-install-recommends stockfish; \
    sf_pkg_bin="$(command -v stockfish || true)"; \
    if [ -z "$sf_pkg_bin" ] && [ -x /usr/games/stockfish ]; then sf_pkg_bin="/usr/games/stockfish"; fi; \
    test -n "$sf_pkg_bin" && test -x "$sf_pkg_bin"; \
    ln -sf "$sf_pkg_bin" /usr/local/bin/stockfish; \
  fi; \
  rm -rf /var/lib/apt/lists/*; \
  printf "uci\nquit\n" | /usr/local/bin/stockfish | grep -q "uciok"

RUN groupadd --system --gid 1001 kingside \
  && useradd --system --uid 1001 --gid kingside --home-dir /app --shell /usr/sbin/nologin kingside

COPY --from=builder --chown=kingside:kingside /app/backend/dist/server.mjs ./backend/dist/server.mjs

USER kingside

ENV NODE_ENV=production \
  PORT=10000 \
  STOCKFISH_BIN=/usr/local/bin/stockfish \
  SERVER_ENGINE_HASH_MB=16 \
  SERVER_ENGINE_MAX_NODES=400000 \
  SERVER_ENGINE_MAX_QUEUE=4 \
  SERVER_ENGINE_TIMEOUT_MS=15000

EXPOSE 10000

CMD ["node", "backend/dist/server.mjs"]
