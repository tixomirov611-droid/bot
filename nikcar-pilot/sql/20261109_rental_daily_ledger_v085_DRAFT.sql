-- NikCar v0.85 FINANCE DRAFT. REVIEW AND TEST BEFORE APPLYING.
-- Additive only: preserves all existing payment_claims and any external legacy debts.
-- Each rental day is posted once. Approved free day -> zero NEW rent, not a debt write-off.
CREATE TABLE IF NOT EXISTS public.nikcar_rent_daily_v085 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rental_request_id uuid NOT NULL REFERENCES public.rental_requests(id),
 driver_id uuid NOT NULL REFERENCES public.profiles(id),
 car_id uuid NOT NULL REFERENCES public.cars(id),
 charge_day date NOT NULL,
 rate_snapshot numeric(12,2) NOT NULL CHECK (rate_snapshot > 0),
 gross_amount numeric(12,2) NOT NULL CHECK (gross_amount >= 0),
 waived_amount numeric(12,2) NOT NULL CHECK (waived_amount >= 0),
 net_amount numeric(12,2) NOT NULL CHECK (net_amount >= 0),
 free_day_id uuid REFERENCES public.driver_days_off(id),
 posted_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT nikcar_daily_unique UNIQUE (rental_request_id,charge_day),
 CONSTRAINT nikcar_daily_reconcile CHECK (
  gross_amount=rate_snapshot AND net_amount=gross_amount-waived_amount AND
  ((free_day_id IS NULL AND waived_amount=0) OR
   (free_day_id IS NOT NULL AND waived_amount=gross_amount AND net_amount=0))
 )
);
CREATE INDEX IF NOT EXISTS nikcar_rent_daily_driver_idx
 ON public.nikcar_rent_daily_v085(driver_id,charge_day);
ALTER TABLE public.nikcar_rent_daily_v085 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nikcar_rent_daily_v085 FROM anon,authenticated;
GRANT SELECT ON TABLE public.nikcar_rent_daily_v085 TO authenticated;
CREATE POLICY nikcar_rent_daily_read_v085 ON public.nikcar_rent_daily_v085
 FOR SELECT TO authenticated USING (
  EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.user_id=(SELECT auth.uid()) AND p.access::text='active'
     AND (p.id=driver_id OR p.role::text='owner')
  )
 );
-- Opening debts are imported separately; never reduce them by "waiver" adjustments.
CREATE TABLE IF NOT EXISTS public.nikcar_rent_opening_debts_v085 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rental_request_id uuid NOT NULL REFERENCES public.rental_requests(id),
 driver_id uuid NOT NULL REFERENCES public.profiles(id),
 source_reference text NOT NULL UNIQUE CHECK (length(source_reference) BETWEEN 3 AND 200),
 amount numeric(12,2) NOT NULL CHECK (amount > 0),
 imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nikcar_rent_opening_debts_v085 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nikcar_rent_opening_debts_v085 FROM anon,authenticated;
GRANT SELECT ON TABLE public.nikcar_rent_opening_debts_v085 TO authenticated;
CREATE POLICY nikcar_opening_debts_read_v085 ON public.nikcar_rent_opening_debts_v085
 FOR SELECT TO authenticated USING (
  EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.user_id=(SELECT auth.uid()) AND p.access::text='active'
     AND (p.id=driver_id OR p.role::text='owner')
  )
 );
-- View obeys underlying RLS; confirmed payments count once by payment_claims ID.
CREATE OR REPLACE VIEW public.nikcar_rent_balances_v085
 WITH (security_invoker=true) AS
 SELECT r.id AS rental_request_id,r.driver_id,r.car_id,
  COALESCE(ob.amount,0::numeric) AS opening_debt,
  COALESCE(rd.gross_amount,0::numeric) AS gross_rent,
  COALESCE(rd.waived_amount,0::numeric) AS waived_rent,
  COALESCE(rd.net_amount,0::numeric) AS posted_rent,
  COALESCE(pc.paid_amount,0::numeric) AS confirmed_payments,
  COALESCE(ob.amount,0::numeric)+COALESCE(rd.net_amount,0::numeric)-COALESCE(pc.paid_amount,0::numeric) AS balance
 FROM public.rental_requests r
 LEFT JOIN (SELECT rental_request_id,SUM(amount) amount
  FROM public.nikcar_rent_opening_debts_v085 GROUP BY rental_request_id) ob ON ob.rental_request_id=r.id
 LEFT JOIN (SELECT rental_request_id,SUM(gross_amount) gross_amount,
  SUM(waived_amount) waived_amount,SUM(net_amount) net_amount
  FROM public.nikcar_rent_daily_v085 GROUP BY rental_request_id) rd ON rd.rental_request_id=r.id
 LEFT JOIN (SELECT rental_request_id,SUM(amount) paid_amount
  FROM public.payment_claims WHERE status='confirmed' GROUP BY rental_request_id) pc ON pc.rental_request_id=r.id;
REVOKE ALL ON TABLE public.nikcar_rent_balances_v085 FROM anon,authenticated;
GRANT SELECT ON TABLE public.nikcar_rent_balances_v085 TO authenticated;
-- This internal function is not exposed through the public Data API.
-- Apply only after validating business rules and enabling a trusted scheduler.
CREATE OR REPLACE FUNCTION private.nikcar_post_rent_day_v085(p_day date)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE posted integer;
BEGIN
 IF p_day IS NULL OR p_day < DATE '2026-11-09'
   OR p_day > (now() AT TIME ZONE 'Europe/Kyiv')::date
 THEN RAISE EXCEPTION 'Invalid posting date' USING ERRCODE='22023'; END IF;
 INSERT INTO public.nikcar_rent_daily_v085(
  rental_request_id,driver_id,car_id,charge_day,rate_snapshot,gross_amount,waived_amount,net_amount,free_day_id)
 SELECT r.id,r.driver_id,r.car_id,p_day,c.daily_rate,c.daily_rate,
  CASE WHEN o.id IS NULL THEN 0 ELSE c.daily_rate END,
  CASE WHEN o.id IS NULL THEN c.daily_rate ELSE 0 END,o.id
 FROM public.rental_requests r
 JOIN public.cars c ON c.id=r.car_id
 LEFT JOIN LATERAL (
   SELECT d.id FROM public.driver_days_off d
   WHERE d.vehicle_id=r.car_id AND d.driver_id=r.driver_id
    AND d.status='approved' AND p_day BETWEEN d.date_from AND d.date_to
   LIMIT 1
 ) o ON true
 WHERE r.status::text IN ('approved','completed')
   AND r.handed_over_at IS NOT NULL
   AND (r.handed_over_at AT TIME ZONE 'Europe/Kyiv')::date<=p_day
   AND (r.returned_at IS NULL OR (r.returned_at AT TIME ZONE 'Europe/Kyiv')::date>=p_day)
 ON CONFLICT (rental_request_id,charge_day) DO NOTHING;
 GET DIAGNOSTICS posted=ROW_COUNT;
 RETURN posted;
END;
$$;
REVOKE ALL ON FUNCTION private.nikcar_post_rent_day_v085(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.nikcar_post_rent_day_v085(date) TO service_role;
-- No cron job, automatic billing or historical backfill is activated by this draft.
