create table IF NOT EXISTS realtime.schema_migrations (
    version bigint not null
    , inserted_at timestamp(0) without time zone
    , primary key (version));