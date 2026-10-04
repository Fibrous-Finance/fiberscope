# The indexer, built from the repository root: docker build -f apps/indexer/Dockerfile .
# Node 24 runs the TypeScript sources directly and neither the indexer nor @fiberscope/core has
# third-party dependencies, so the image is Node plus the workspace link. The database and the
# local snapshot live on a volume mounted at /data.
FROM node:24-slim

WORKDIR /app
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Every workspace manifest, so the frozen lockfile matches; only the indexer's part is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core packages/core
COPY apps/indexer apps/indexer
RUN pnpm install --frozen-lockfile --prod --filter @fiberscope/indexer...

ENV DB_PATH=/data/base.db
# --budget-minutes matches loop.sh's default REFRESH_MINUTES (10); change them together. --prune
# keeps the database at the depths the page shows.
CMD ["sh", "apps/indexer/loop.sh", "--snapshot", "/data/snapshot.json", "--chain-days", "180", "--auction-days", "90", "--budget-minutes", "10", "--prune"]
