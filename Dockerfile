FROM node:20-slim AS base
WORKDIR /app
# node:20-slim ships npm 10.8.2, which has the "Exit handler never called!"
# bug that aborts install finalization (bin-linking) -> `next: not found`.
# Pin to the npm that generated package-lock.json.
RUN npm install -g npm@10.9.3
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
