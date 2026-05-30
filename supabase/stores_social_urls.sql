-- Social media links for public storefront (SocialBar)
-- Execute in Supabase SQL Editor after public.stores exists.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text;

COMMENT ON COLUMN public.stores.instagram_url IS 'Public Instagram profile URL for storefront SocialBar';
COMMENT ON COLUMN public.stores.facebook_url IS 'Public Facebook page URL for storefront SocialBar';
COMMENT ON COLUMN public.stores.tiktok_url IS 'Public TikTok profile URL for storefront SocialBar';
