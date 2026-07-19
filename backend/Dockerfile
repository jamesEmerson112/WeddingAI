# Railway picks this up automatically (preferred over Railpack). The toolchain
# is pinned because Railpack's default rustc (1.85.1) is older than what the
# locked icu_* crates require (1.86+).
FROM rust:1.88-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/backend /usr/local/bin/backend
CMD ["backend"]
