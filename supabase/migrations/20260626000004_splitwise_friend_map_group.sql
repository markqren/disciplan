-- FEA-29C: remember a default Splitwise group per person label, so a push can
-- land in the right group (not just a direct friend split). Both nullable: a
-- NULL / 0 group means a non-group ("direct") expense between you and the friend.

ALTER TABLE disciplan.splitwise_friend_map
  ADD COLUMN IF NOT EXISTS sw_group_id   BIGINT,
  ADD COLUMN IF NOT EXISTS sw_group_name TEXT;
