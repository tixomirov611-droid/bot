-- NikCar 1.20.5 / read-only finance regression audit
-- Safe to run against production: SELECT only, no user-level data returned.
WITH checks AS (
 SELECT 'duplicate_weekly_charge' AS check_name, count(*)::bigint AS violations
 FROM (SELECT rental_id,week_start FROM public.nikcar_weekly_rent GROUP BY 1,2 HAVING count(*)>1) t
 UNION ALL
 SELECT 'invalid_charge_math',count(*) FROM public.nikcar_weekly_rent
 WHERE gross<0 OR discount<0 OR amount_due<0 OR paid_amount<0
    OR discount>gross OR abs(amount_due-(gross-discount))>0.01
 UNION ALL
 SELECT 'weekly_paid_exceeds_due',count(*) FROM public.nikcar_weekly_rent
 WHERE paid_amount>amount_due+0.01
 UNION ALL
 SELECT 'weekly_paid_allocation_mismatch',count(*) FROM public.nikcar_weekly_rent w
 WHERE abs(w.paid_amount-coalesce((SELECT sum(a.amount) FROM public.nikcar_rent_allocations a WHERE a.weekly_rent_id=w.id),0))>0.01
 UNION ALL
 SELECT 'opening_paid_allocation_mismatch',count(*) FROM public.nikcar_rent_opening_balances b
 WHERE abs(b.paid_amount-coalesce((SELECT sum(a.amount) FROM public.nikcar_rent_opening_allocations a WHERE a.rental_id=b.rental_id),0))>0.01
 UNION ALL
 SELECT 'payment_allocated_over_amount',count(*) FROM public.payment_claims p
 WHERE coalesce((SELECT sum(a.amount) FROM public.nikcar_rent_allocations a WHERE a.payment_id=p.id),0)
     + coalesce((SELECT sum(a.amount) FROM public.nikcar_rent_opening_allocations a WHERE a.payment_id=p.id),0)>p.amount+0.01
 UNION ALL
 SELECT 'unallocated_confirmed_rent',count(*) FROM public.payment_claims p
 WHERE p.status='confirmed' AND p.driver_note LIKE '[rent]%'
 AND p.amount>coalesce((SELECT sum(a.amount) FROM public.nikcar_rent_allocations a WHERE a.payment_id=p.id),0)
     +coalesce((SELECT sum(a.amount) FROM public.nikcar_rent_opening_allocations a WHERE a.payment_id=p.id),0)+0.01
 UNION ALL
 SELECT 'confirmed_missing_timestamp',count(*) FROM public.payment_claims
 WHERE status='confirmed' AND confirmed_at IS NULL
)
SELECT check_name,violations,CASE WHEN violations=0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY check_name;
