FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

RUN mkdir -p /data

ENV NODE_ENV=production
ENV ACP_PORT=3000
ENV ACP_DB_PATH=/data/acp.db
ENV ACP_AUDIT_PATH=/data/audit.jsonl

EXPOSE 3000

CMD ["node", "dist/index.js"]
