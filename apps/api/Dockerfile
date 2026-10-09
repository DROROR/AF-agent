# Built and run from the monorepo root (docker-compose.yml uses `context: .`)
# because npm workspaces need the root package.json/lockfile and the
# sibling packages/schemas + packages/database.
FROM node:22-alpine

# ffprobe measures an uploaded video's size and duration (2026-10-09, see
# apps/api/src/domain/asset/probe-video-facts.ts).
RUN apk add --no-cache ffmpeg

WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/database/package.json packages/database/package.json
COPY apps/api/package.json apps/api/package.json

RUN npm ci

COPY packages/schemas packages/schemas
COPY packages/database packages/database
COPY apps/api apps/api

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "--workspace", "apps/api", "run", "start"]
