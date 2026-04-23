ALTER TABLE public.site_brand_profiles
  ADD COLUMN IF NOT EXISTS niche_profile jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.site_brand_profiles.niche_profile IS
  'Answers to the Site Builder clarifying wizard: business_type, target_audience, products_overview, usp, tone_of_voice, must_have_features (string[]), competitor_urls (string[]), growth_goal. Drives niche-tailored seed content.';