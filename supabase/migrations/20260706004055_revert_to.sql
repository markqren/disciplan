-- FEA: Point-in-time revert (Adobe-style "revert to this state")
--
-- Builds on 20260629043949_audit_ledger.sql. Reverts every non-reverted change
-- newer than p_id, applied newest-first, so the data is reconstructed exactly to
-- the state right after audit entry p_id. Running it in one transaction makes the
-- whole rollback atomic (all-or-nothing) and — because each reversal is itself
-- audited under a single txid — the entire "revert to here" is redoable as a unit.
--
-- Permission per row is enforced by revert_audit_entry -> can_write(); household
-- scoping keeps a call from ever touching another household's rows. Only entries
-- created after the audit ledger migration exist, so this is forward-looking.

CREATE OR REPLACE FUNCTION disciplan.revert_to(p_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = disciplan, public AS $$
DECLARE
  rec     RECORD;
  v_count INT := 0;
  v_hh    BIGINT := disciplan.my_household();
BEGIN
  -- Snapshot the target set before the loop. The reversals insert NEW audit rows
  -- (id > any existing), but the implicit cursor's snapshot is fixed at loop
  -- start, so those inverse entries are never re-processed here.
  FOR rec IN
    SELECT id FROM disciplan.audit_log
    WHERE id > p_id
      AND reverted_at IS NULL
      AND (v_hh IS NULL OR household_id IS NULL OR household_id = v_hh)
    ORDER BY id DESC
  LOOP
    PERFORM disciplan.revert_audit_entry(rec.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('up_to', p_id, 'reverted', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION disciplan.revert_to(BIGINT) TO authenticated, service_role;
