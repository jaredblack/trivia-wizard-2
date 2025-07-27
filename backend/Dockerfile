FROM rust:1.88-slim-bullseye

WORKDIR /usr/src/app

COPY Cargo.toml Cargo.lock ./

COPY src ./src

RUN cargo build --release

EXPOSE 9002
EXPOSE 8080

ENV RUST_LOG=info
ENV ECS_CLUSTER=TriviaWizardService
ENV ECS_ENABLE_CONTAINER_METADATA=true

CMD ["./target/release/backend"]
