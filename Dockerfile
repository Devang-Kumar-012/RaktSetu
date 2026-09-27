# RaktSetu — production image.
#
# WHY A CONTAINER
#
# The data layer is server-side SQLite: ONE FILE on a PERSISTENT, WRITABLE
# volume. That requirement rules out function-style serverless platforms (their
# filesystems are read-only and ephemeral), and it is satisfied by a long-running
# container with a mounted volume. This image is the portable form of that, so
# the same artefact runs on any host that can mount a disk.
#
# WHAT THIS IMAGE GUARANTEES
#
#   - the database is NEVER inside the image layer. `/data` is a volume, and
#     RAKTSETU_DATA_DIR points at it, so a rebuild or a container replacement
#     cannot take accounts with it;
#   - it runs `next start` (the production server), never `next dev`;
#   - the database is initialised at START, on the mounted volume, before the
#     first request is served;
#   - it runs as a non-root user, and binds to 0.0.0.0 on $PORT so it works
#     behind any proxy or PaaS router.
#
# Node 22.13+ is required: `node:sqlite` is only available unflagged from 22.13.

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
# Only the manifest, so this layer is reused whenever dependencies are unchanged.
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build must not depend on a writable data directory; it renders pages that
# open the database lazily, so no data is created in the image.
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# The persistent volume mount point. Declared as a VOLUME so a plain
# `docker run` without a bind mount still gets a named volume rather than
# writing into the container layer.
VOLUME /data
ENV RAKTSETU_DATA_DIR=/data

# The non-root user owns the app; it must also be able to write /data, which a
# bind-mounted host directory can be made to allow with matching ownership.
RUN addgroup -g 1001 -S raktsetu && adduser -u 1001 -S raktsetu -G raktsetu \
 && mkdir -p /data && chown -R raktsetu:raktsetu /data /app

COPY --from=build --chown=raktsetu:raktsetu /app/node_modules ./node_modules
COPY --from=build --chown=raktsetu:raktsetu /app/.next ./.next
COPY --from=build --chown=raktsetu:raktsetu /app/package.json ./package.json
COPY --from=build --chown=raktsetu:raktsetu /app/next.config.ts ./next.config.ts
COPY --from=build --chown=raktsetu:raktsetu /app/scripts ./scripts
COPY --from=build --chown=raktsetu:raktsetu /app/src ./src
COPY --from=build --chown=raktsetu:raktsetu /app/tsconfig.json ./tsconfig.json

USER raktsetu
EXPOSE 3000

# Fail the container if the persistent volume cannot actually be written to,
# rather than serving pages that 500 on every request. This is the single most
# valuable line here: it turns a silent data-loss configuration into a loud,
# obvious boot failure.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Init (idempotent, non-destructive) then serve. `sh -c` so $PORT expands at run
# time, which is how every PaaS supplies it.
CMD ["sh", "-c", "npx tsx scripts/db-init.ts && exec npx next start -p ${PORT:-3000} -H 0.0.0.0"]
