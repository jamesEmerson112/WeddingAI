-- Runs once on first boot of the Postgres container (docker-entrypoint-initdb.d).
-- Keeps `cargo test` off the same database you use for `cargo run`.
CREATE DATABASE weddingai_test;
