-- Bridge: mirror new ai_insights into owner_notifications (only meaningful risk)
CREATE OR REPLACE FUNCTION public.tg_mirror_insight_to_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _severity text;
BEGIN
  -- Skip low-risk noise
  IF NEW.risk_level NOT IN ('high','medium') THEN
    RETURN NEW;
  END IF;

  _severity := CASE NEW.risk_level
    WHEN 'high' THEN 'high'
    WHEN 'medium' THEN 'warning'
    ELSE 'info'
  END;

  INSERT INTO public.owner_notifications (
    tenant_id, kind, severity, title, body, link, metadata
  ) VALUES (
    NEW.tenant_id,
    'insight',
    _severity,
    NEW.title,
    NEW.description,
    '/brand',
    jsonb_build_object(
      'insight_id', NEW.id,
      'insight_type', NEW.insight_type,
      'risk_level', NEW.risk_level,
      'expected_impact', NEW.expected_impact
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_insight_to_notifications ON public.ai_insights;
CREATE TRIGGER trg_mirror_insight_to_notifications
  AFTER INSERT ON public.ai_insights
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mirror_insight_to_notifications();