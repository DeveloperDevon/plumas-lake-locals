ALTER TABLE "businesses" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(display_name, '') || ' ' || coalesce(bio, ''))) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "businesses_search_vector_idx" ON "businesses" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_search_vector_idx" ON "groups" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_search_vector_idx" ON "posts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_search_vector_idx" ON "users" USING gin ("search_vector");