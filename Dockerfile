# ---- Builder stage ----
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --network-timeout 600000 && npm rebuild && npm cache clean --force

COPY src/ src/
COPY bin/ bin/
COPY ci-bin/ ci-bin/
COPY config/ config/

RUN npm run build && npx oclif manifest

RUN --mount=type=secret,id=github_token \
    GITHUB_TOKEN=$(cat /run/secrets/github_token 2>/dev/null || true) npm run ci:download-web-uis

# ---- Production dependencies ----
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare && npm ci --omit=dev --ignore-scripts --network-timeout 600000 && npm rebuild && npm cache clean --force

# ---- Runtime stage ----
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends tini git ca-certificates && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 bitsocial && \
    useradd --uid 1001 --gid bitsocial --shell /bin/bash --create-home bitsocial

WORKDIR /app

COPY --from=deps /app/node_modules/ node_modules/
COPY package.json package-lock.json ./

COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/oclif.manifest.json ./
COPY bin/ bin/
RUN chmod +x bin/run
RUN ln -s /app/bin/run /usr/local/bin/bitsocial

RUN mkdir -p /data /logs && chown -R bitsocial:bitsocial /data /logs /app

USER bitsocial

ENV XDG_DATA_HOME=/data
ENV XDG_STATE_HOME=/logs
ENV KUBO_RPC_URL="http://0.0.0.0:50019/api/v0"
ENV IPFS_GATEWAY_URL="http://0.0.0.0:6473"

EXPOSE 9138 50019 6473

VOLUME ["/data", "/logs"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "const net=require('net');const s=net.connect(9138,'localhost',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),5000)"

ENTRYPOINT ["tini", "--"]
CMD ["bitsocial", "daemon"]
