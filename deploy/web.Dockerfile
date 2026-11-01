# syntax=docker/dockerfile:1

# The web front door: the built React app, served by Caddy, which also proxies
# /api to the tutor API container. One image, so the frontend and the server
# that serves it are always the same version.
#
# Built by docker-compose.yml with the FRONTEND directory as the context.

# ---- build the React app ------------------------------------------------------
# Debian rather than Alpine: Vite 8's bundler ships native binaries, and the
# glibc ones are the well-trodden path.
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Vite inlines VITE_* values into the JavaScript AT BUILD TIME, so they arrive
# as build arguments, not as runtime settings. Only public values belong here:
# the Supabase URL and publishable key, and the Desmos key, are all readable in
# the shipped JavaScript by design. Never pass a service-role or OpenAI key.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_DESMOS_API_KEY=""

# Served from the site root, and the API is reached at /api on the SAME site.
# A relative address means the build never names a server, so it keeps working
# whatever address the box is given -- no rebuild when the URL changes.
ENV VITE_BASE_PATH=/ \
    VITE_API_BASE_URL=/api \
    VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_DESMOS_API_KEY=${VITE_DESMOS_API_KEY}

# Fail the build rather than ship an app that cannot sign anyone in.
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" \
    || (echo "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set in deploy/.env" && exit 1)

RUN npm run build

# ---- serve it -------------------------------------------------------------------
FROM caddy:2-alpine

COPY --from=build /app/dist /srv
