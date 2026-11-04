import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Browser-generated UUIDs are pseudonymous vote keys, never an IP address.
export const photoVotes = sqliteTable('photo_votes', {
  photoId: text('photo_id').notNull(),
  voterId: text('voter_id').notNull(),
  rating: integer('rating').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.photoId, table.voterId] }),
  check('rating_range', sql`${table.rating} BETWEEN 1 AND 5`),
]);

// The token is HMAC(IP + window), so it cannot link different rate windows.
export const ratingRateLimits = sqliteTable('rating_rate_limits', {
  token: text('token').primaryKey().notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [
  index('rating_rate_limits_expiry').on(table.expiresAt),
  check('positive_attempts', sql`${table.attempts} >= 1`),
]);
