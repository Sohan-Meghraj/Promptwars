-- Record a terminal intervention outcome exactly once, then update the
-- strategy evidence used for the same domain and local time of day.
create or replace function public.resolve_restriction_attempt_outcome(
  p_attempt_id uuid,
  p_user_id uuid,
  p_outcome public.attempt_outcome,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_attempt public.restriction_attempts%rowtype;
  outcome_is_success boolean;
  outcome_time_bucket public.time_of_day_bucket;
begin
  update public.restriction_attempts
  set final_outcome = p_outcome,
      resolved_at = p_occurred_at
  where id = p_attempt_id
    and user_id = p_user_id
    and final_outcome is null
  returning * into resolved_attempt;

  if not found then
    return false;
  end if;

  outcome_is_success := p_outcome in ('returned_to_focus', 'reset_completed');
  outcome_time_bucket := case
    when resolved_attempt.local_hour < 6 then 'late_night'::public.time_of_day_bucket
    when resolved_attempt.local_hour < 12 then 'morning'::public.time_of_day_bucket
    when resolved_attempt.local_hour < 18 then 'afternoon'::public.time_of_day_bucket
    else 'evening'::public.time_of_day_bucket
  end;

  insert into public.strategy_scores (
    user_id,
    domain,
    strategy,
    time_bucket,
    attempt_count,
    successful_interruptions,
    effectiveness_score,
    last_outcome_at
  )
  select
    resolved_attempt.user_id,
    restrictions.domain,
    resolved_attempt.strategy,
    outcome_time_bucket,
    1,
    case when outcome_is_success then 1 else 0 end,
    case when outcome_is_success then 1.0000 else 0.0000 end,
    p_occurred_at
  from public.restrictions
  where restrictions.id = resolved_attempt.restriction_id
    and restrictions.user_id = resolved_attempt.user_id
  on conflict (user_id, domain, strategy, time_bucket) do update
  set attempt_count = public.strategy_scores.attempt_count + 1,
      successful_interruptions = public.strategy_scores.successful_interruptions
        + case when outcome_is_success then 1 else 0 end,
      effectiveness_score = round(
        (public.strategy_scores.successful_interruptions + case when outcome_is_success then 1 else 0 end)::numeric
        / (public.strategy_scores.attempt_count + 1),
        4
      ),
      last_outcome_at = p_occurred_at;

  return true;
end;
$$;

revoke all on function public.resolve_restriction_attempt_outcome(uuid, uuid, public.attempt_outcome, timestamptz)
from public, anon, authenticated;
grant execute on function public.resolve_restriction_attempt_outcome(uuid, uuid, public.attempt_outcome, timestamptz)
to service_role;
