FROM node:20-slim AS base
WORKDIR /app
# `npm ci` consistently hangs ~300s then dies "Exit handler never called!" in
# this image (npm-internal install bug, not network — `npm i -g` is instant).
# Install with pnpm (different engine) instead. Installing pnpm via `npm i -g`
# is the fast/reliable path. IPv4-first as cheap network insurance.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
EXPOSE 3000
CMD ["pnpm", "run", "start"]
