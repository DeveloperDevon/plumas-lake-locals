ALTER TABLE "users" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "interests" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "occupation" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pets" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthday_month" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthday_day" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "field_visibility" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birthday_month_check" CHECK ("users"."birthday_month" is null or "users"."birthday_month" between 1 and 12);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birthday_day_check" CHECK ("users"."birthday_day" is null or "users"."birthday_day" between 1 and 31);