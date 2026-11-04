CREATE TABLE `photo_votes` (
	`photo_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`rating` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`photo_id`, `voter_id`),
	CONSTRAINT "rating_range" CHECK("photo_votes"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE `rating_rate_limits` (
	`token` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "positive_attempts" CHECK("rating_rate_limits"."attempts" >= 1)
);
--> statement-breakpoint
CREATE INDEX `rating_rate_limits_expiry` ON `rating_rate_limits` (`expires_at`);