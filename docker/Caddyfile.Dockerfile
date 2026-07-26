ARG CADDY_RATELIMIT_VERSION=5625512f24f6f59d6f64fb3aafe5eecff0b286db

FROM caddy:2-builder AS builder
ARG CADDY_RATELIMIT_VERSION
RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit@${CADDY_RATELIMIT_VERSION}

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
