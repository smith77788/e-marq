-- Fix ai_memory UNIQUE constraint: (tenant_id, pattern_key) → (tenant_id, agent, category, pattern_key)
--
-- The old constraint caused INSERT failures in the memory-feedback agent when two
-- different agents both produced the same pattern_key (e.g., "product:<uuid>").
-- The second agent's INSERT would conflict and silently fail, losing learning data.
--
-- The correct scope for a unique pattern is per agent+category+key, not just per tenant+key.

-- Drop the old 2-column unique constraint
ALTER TABLE public.ai_memory
  DROP CONSTRAINT IF EXISTS ai_memory_tenant_id_pattern_key_key;

-- Also drop any unique index with same columns that might exist under a different name
DROP INDEX IF EXISTS ai_memory_tenant_id_pattern_key_key;

-- Add the correct 4-column unique constraint
ALTER TABLE public.ai_memory
  ADD CONSTRAINT ai_memory_tenant_agent_category_pattern_key
  UNIQUE (tenant_id, agent, category, pattern_key);

-- Also add an index to accelerate the select-then-upsert lookup used in memory-feedback agent
CREATE INDEX IF NOT EXISTS idx_ai_memory_lookup
  ON public.ai_memory (tenant_id, agent, category, pattern_key);
