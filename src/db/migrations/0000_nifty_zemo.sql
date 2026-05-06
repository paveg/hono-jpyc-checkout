CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expected_from_address` text,
	`receiving_address` text NOT NULL,
	`tx_hash` text,
	`block_number` integer,
	`paid_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`metadata` text NOT NULL,
	CONSTRAINT "status_valid" CHECK("sessions"."status" IN ('pending', 'paid', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_tx_hash_unique` ON `sessions` (`tx_hash`) WHERE "sessions"."tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `sessions_status_expires_idx` ON `sessions` (`status`,`expires_at`);