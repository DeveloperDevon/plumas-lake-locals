ALTER TABLE "messages" ALTER COLUMN "ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD COLUMN "hidden_at" timestamp with time zone;