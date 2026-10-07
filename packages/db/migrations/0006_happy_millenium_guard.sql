CREATE TYPE "public"."post_category" AS ENUM('general', 'lost_found', 'safety', 'recommendations');--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "category" "post_category";--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
