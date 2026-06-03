FROM node:20-slim AS base
WORKDIR /app
# Prefer IPv4: in many containers IPv6 egress is broken, so npm hangs on a
# package fetch until the ~300s fetch-timeout, then dies with
# "Exit handler never called!" (leaving `next` unlinked -> not found).
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# node:20-slim ships npm 10.8.2 (also has the exit-handler bug); pin to the
# npm that generated package-lock.json.
RUN npm install -g npm@10.9.3
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
