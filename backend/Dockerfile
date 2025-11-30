# Build stage
FROM rust:1-slim-trixie AS builder

WORKDIR /usr/src/app

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

# Runtime stage
FROM debian:trixie-slim

RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/app/target/release/backend /app/backend

EXPOSE 9002
EXPOSE 8080

ENV RUST_LOG=info
ENV ECS_CLUSTER=TriviaWizardService
ENV ECS_ENABLE_CONTAINER_METADATA=true

CMD ["/app/backend"]
