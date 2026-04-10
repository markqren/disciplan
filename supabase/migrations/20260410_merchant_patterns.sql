-- FEA-88: Merchant patterns RPC
-- Returns top 200 description+category pairs with count >= 3.
-- Replaces client-side paginated fetch of all 12K+ transactions.

CREATE OR REPLACE FUNCTION get_merchant_patterns()
RETURNS TABLE(description TEXT, category_id TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT description, category_id, COUNT(*) AS count
  FROM transactions
  GROUP BY 1, 2
  HAVING COUNT(*) > 2
  ORDER BY 3 DESC
  LIMIT 200;
$$;
