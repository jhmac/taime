-- Add unique constraint to user_shops to prevent duplicate user-shop links
-- This enforces the multi-tenant authorization boundary at the database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_shops_unique ON user_shops (user_id, shop_domain);
