-- Adds 30-day trial tracking for SaaS stores.
-- Execute after public.stores exists.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NULL;

COMMENT ON COLUMN public.stores.trial_ends_at IS 'UTC timestamp indicating when the free trial expires';
