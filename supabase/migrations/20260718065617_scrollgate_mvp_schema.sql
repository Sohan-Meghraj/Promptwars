-- ScrollGate MVP schema
--
-- The browser extension and web app use authenticated server routes for all
-- behavior writes.  Direct Data API access is deliberately limited to the
-- profile and restriction-management data needed by an authenticated user.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.coaching_tone as enum (
  'sarcastic_gen_z',
  'supportive_friend',
  'direct_coach',
  'calm_neutral'
);

create type public.intervention_strategy as enum (
  'deadline_reminder',
  'goal_reminder',
  'time_remaining_reminder',
  'previous_commitment_reminder',
  'attempt_count_observation',
  'next_action_prompt',
  'environment_change_prompt',
  'cost_of_distraction_reminder',
  'progress_reinforcement',
  'humor_only_interruption',
  'intentionality_question'
);

create type public.browser_platform as enum ('chromium');
create type public.attempt_source as enum ('navigation', 'rule_test');
create type public.attempt_outcome as enum (
  'returned_to_focus',
  'reset_completed',
  'reset_skipped',
  'intentional_access_granted',
  'override_confirmed',
  'abandoned'
);
create type public.attempt_event_type as enum (
  'attempt_created',
  'gate_shown',
  'return_to_focus',
  'reset_started',
  'reset_completed',
  'reset_skipped',
  'intentional_access_requested',
  'intentional_access_granted',
  'intentional_access_expired',
  'override_started',
  'override_confirmed',
  'ai_fallback_displayed'
);
create type public.intervention_source as enum ('ai_generated', 'cached_ai_generated', 'local_fallback');
create type public.access_session_status as enum ('active', 'expired', 'completed', 'cancelled', 'revoked');
create type public.time_of_day_bucket as enum ('morning', 'afternoon', 'evening', 'late_night');
create type public.ai_request_status as enum ('succeeded', 'failed', 'timed_out', 'rejected', 'fallback');

create function private.valid_active_days(days smallint[])
returns boolean
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select
    pg_catalog.cardinality(days) between 1 and 7
    and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and pg_catalog.cardinality(days) = (
      select pg_catalog.count(distinct day)::integer
      from pg_catalog.unnest(days) as day
    );
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC'
    check (timezone ~ '^(UTC|[A-Za-z_]+/[A-Za-z0-9_+.-]+)$'),
  default_tone public.coaching_tone not null default 'sarcastic_gen_z',
  focus_destination text,
  rules_version integer not null default 0 check (rules_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  constraint profiles_focus_destination_length
    check (focus_destination is null or char_length(btrim(focus_destination)) between 1 and 2048)
);

create table public.restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  domain text not null,
  active_days smallint[] not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  timezone text not null default 'UTC',
  goal text not null,
  reason text not null,
  tone public.coaching_tone not null default 'sarcastic_gen_z',
  max_temporary_access_minutes smallint not null default 10,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restrictions_id_user_id_key unique (id, user_id),
  constraint restrictions_user_domain_key unique (user_id, domain),
  constraint restrictions_domain_normalized check (
    domain = lower(domain)
    and domain = btrim(domain)
    and char_length(domain) between 3 and 253
    and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  constraint restrictions_active_days_valid check (
    private.valid_active_days(active_days)
  ),
  constraint restrictions_time_window_nonzero check (start_time <> end_time),
  constraint restrictions_timezone_format check (
    timezone ~ '^(UTC|[A-Za-z_]+/[A-Za-z0-9_+.-]+)$'
  ),
  constraint restrictions_goal_length check (char_length(btrim(goal)) between 1 and 240),
  constraint restrictions_reason_length check (char_length(btrim(reason)) between 1 and 500),
  constraint restrictions_temporary_access_range check (
    max_temporary_access_minutes between 1 and 60
  )
);

create table public.browser_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  install_id uuid not null default gen_random_uuid(),
  nickname text not null default 'This browser',
  platform public.browser_platform not null default 'chromium',
  extension_version text,
  connection_token_hash text unique,
  last_synced_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint browser_connections_id_user_id_key unique (id, user_id),
  constraint browser_connections_install_id_key unique (install_id),
  constraint browser_connections_nickname_length check (
    char_length(btrim(nickname)) between 1 and 80
  ),
  constraint browser_connections_extension_version_length check (
    extension_version is null or char_length(btrim(extension_version)) between 1 and 80
  ),
  constraint browser_connections_connection_token_hash_length check (
    connection_token_hash is null or char_length(connection_token_hash) between 32 and 255
  ),
  constraint browser_connections_revocation_valid check (
    revoked_at is null or revoked_at >= created_at
  )
);

-- Pairing codes contain only a server-generated hash. The raw short-lived
-- numeric code is never persisted in this table or exposed through the Data API.
create table public.browser_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  browser_connection_id uuid,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint browser_pairing_codes_code_hash_length check (
    char_length(code_hash) between 32 and 255
  ),
  constraint browser_pairing_codes_expiry_valid check (
    expires_at > created_at
    and expires_at <= created_at + interval '15 minutes'
  ),
  constraint browser_pairing_codes_consumption_valid check (
    consumed_at is null or (consumed_at >= created_at and consumed_at <= expires_at)
  ),
  constraint browser_pairing_codes_browser_owner_fkey foreign key (browser_connection_id, user_id)
    references public.browser_connections (id, user_id) on delete restrict,
  constraint browser_pairing_codes_user_hash_key unique (user_id, code_hash)
);

create table public.restriction_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  restriction_id uuid not null,
  browser_connection_id uuid,
  source public.attempt_source not null default 'navigation',
  strategy public.intervention_strategy not null,
  client_event_id uuid not null,
  local_timezone text not null,
  local_hour smallint not null,
  attempted_at timestamptz not null default now(),
  final_outcome public.attempt_outcome,
  resolved_at timestamptz,
  used_ai_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  constraint restriction_attempts_id_user_id_key unique (id, user_id),
  constraint restriction_attempts_browser_client_event_key unique (browser_connection_id, client_event_id),
  constraint restriction_attempts_restriction_owner_fkey foreign key (restriction_id, user_id)
    references public.restrictions (id, user_id) on delete cascade,
  constraint restriction_attempts_browser_owner_fkey foreign key (browser_connection_id, user_id)
    references public.browser_connections (id, user_id) on delete restrict,
  constraint restriction_attempts_timezone_format check (
    local_timezone ~ '^(UTC|[A-Za-z_]+/[A-Za-z0-9_+.-]+)$'
  ),
  constraint restriction_attempts_local_hour_range check (local_hour between 0 and 23),
  constraint restriction_attempts_resolution_consistent check (
    (final_outcome is null and resolved_at is null)
    or (final_outcome is not null and resolved_at is not null and resolved_at >= attempted_at)
  )
);

create table public.attempt_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempt_id uuid not null,
  client_event_id uuid not null,
  event_type public.attempt_event_type not null,
  event_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint attempt_events_attempt_owner_fkey foreign key (attempt_id, user_id)
    references public.restriction_attempts (id, user_id) on delete cascade,
  constraint attempt_events_attempt_client_event_key unique (attempt_id, client_event_id),
  constraint attempt_events_payload_object check (jsonb_typeof(event_payload) = 'object')
);

create table public.interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempt_id uuid not null,
  strategy public.intervention_strategy not null,
  tone public.coaching_tone not null,
  source public.intervention_source not null,
  headline text not null,
  message text not null,
  suggested_action text not null,
  reset_text text,
  model_name text,
  prompt_version text not null,
  generated_at timestamptz not null default now(),
  shown_at timestamptz,
  constraint interventions_id_user_id_key unique (id, user_id),
  constraint interventions_attempt_user_key unique (attempt_id, user_id),
  constraint interventions_attempt_owner_fkey foreign key (attempt_id, user_id)
    references public.restriction_attempts (id, user_id) on delete cascade,
  constraint interventions_headline_length check (char_length(btrim(headline)) between 1 and 160),
  constraint interventions_message_length check (char_length(btrim(message)) between 1 and 800),
  constraint interventions_suggested_action_length check (
    char_length(btrim(suggested_action)) between 1 and 240
  ),
  constraint interventions_reset_text_length check (
    reset_text is null or char_length(btrim(reset_text)) between 1 and 500
  ),
  constraint interventions_model_name_length check (
    model_name is null or char_length(btrim(model_name)) between 1 and 120
  ),
  constraint interventions_prompt_version_length check (
    char_length(btrim(prompt_version)) between 1 and 80
  ),
  constraint interventions_shown_after_generated check (
    shown_at is null or shown_at >= generated_at
  )
);

create table public.access_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  restriction_id uuid not null,
  browser_connection_id uuid not null,
  attempt_id uuid not null,
  purpose text not null,
  task_description text not null,
  requested_minutes smallint not null,
  status public.access_session_status not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint access_sessions_restriction_owner_fkey foreign key (restriction_id, user_id)
    references public.restrictions (id, user_id) on delete cascade,
  constraint access_sessions_browser_owner_fkey foreign key (browser_connection_id, user_id)
    references public.browser_connections (id, user_id) on delete restrict,
  constraint access_sessions_attempt_owner_fkey foreign key (attempt_id, user_id)
    references public.restriction_attempts (id, user_id) on delete cascade,
  constraint access_sessions_task_description_length check (
    char_length(btrim(task_description)) between 3 and 500
  ),
  constraint access_sessions_purpose_length check (
    char_length(btrim(purpose)) between 2 and 80
  ),
  constraint access_sessions_requested_minutes_range check (requested_minutes between 1 and 60),
  constraint access_sessions_expiry_range check (
    expires_at > starts_at and expires_at <= starts_at + interval '60 minutes'
  ),
  constraint access_sessions_status_consistent check (
    (status = 'active' and ended_at is null)
    or (status <> 'active' and ended_at is not null and ended_at >= starts_at)
  )
);

create table public.strategy_scores (
  user_id uuid not null references public.profiles (id) on delete cascade,
  domain text not null,
  strategy public.intervention_strategy not null,
  time_bucket public.time_of_day_bucket not null,
  attempt_count integer not null default 0,
  successful_interruptions integer not null default 0,
  effectiveness_score numeric(5,4) not null default 0.5000,
  last_outcome_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, domain, strategy, time_bucket),
  constraint strategy_scores_domain_normalized check (
    domain = lower(domain)
    and domain = btrim(domain)
    and char_length(domain) between 3 and 253
    and domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
  ),
  constraint strategy_scores_counts_valid check (
    attempt_count >= 0
    and successful_interruptions between 0 and attempt_count
  ),
  constraint strategy_scores_effectiveness_range check (
    effectiveness_score between 0.0000 and 1.0000
  )
);

-- Store observability metadata, never raw API keys or full prompts. Rendered
-- intervention copy belongs in interventions; this table is server-only.
create table public.ai_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  attempt_id uuid,
  intervention_id uuid,
  provider text not null default 'gemini',
  model_name text not null,
  prompt_version text not null,
  status public.ai_request_status not null,
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  latency_ms integer,
  safety_passed boolean,
  failure_code text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_request_logs_attempt_owner_fkey foreign key (attempt_id, user_id)
    references public.restriction_attempts (id, user_id) on delete cascade,
  constraint ai_request_logs_intervention_owner_fkey foreign key (intervention_id, user_id)
    references public.interventions (id, user_id) on delete cascade,
  constraint ai_request_logs_provider_length check (char_length(btrim(provider)) between 1 and 64),
  constraint ai_request_logs_model_name_length check (char_length(btrim(model_name)) between 1 and 120),
  constraint ai_request_logs_prompt_version_length check (
    char_length(btrim(prompt_version)) between 1 and 80
  ),
  constraint ai_request_logs_request_metadata_object check (
    jsonb_typeof(request_metadata) = 'object'
  ),
  constraint ai_request_logs_response_metadata_object check (
    jsonb_typeof(response_metadata) = 'object'
  ),
  constraint ai_request_logs_latency_range check (latency_ms is null or latency_ms >= 0),
  constraint ai_request_logs_failure_code_length check (
    failure_code is null or char_length(btrim(failure_code)) between 1 and 120
  ),
  constraint ai_request_logs_completion_valid check (
    completed_at is null or completed_at >= requested_at
  )
);

create index restrictions_user_enabled_idx
  on public.restrictions (user_id, is_enabled);
create index browser_connections_user_active_idx
  on public.browser_connections (user_id, last_synced_at desc)
  where revoked_at is null;
create index browser_pairing_codes_unconsumed_expiry_idx
  on public.browser_pairing_codes (expires_at)
  where consumed_at is null;
create index restriction_attempts_user_attempted_idx
  on public.restriction_attempts (user_id, attempted_at desc);
create index restriction_attempts_restriction_attempted_idx
  on public.restriction_attempts (restriction_id, attempted_at desc);
create index attempt_events_user_occurred_idx
  on public.attempt_events (user_id, occurred_at desc);
create index attempt_events_attempt_occurred_idx
  on public.attempt_events (attempt_id, occurred_at asc);
create index interventions_attempt_shown_idx
  on public.interventions (attempt_id, shown_at desc);
create index access_sessions_user_expires_idx
  on public.access_sessions (user_id, expires_at desc);
create unique index access_sessions_one_active_per_rule_browser_idx
  on public.access_sessions (user_id, restriction_id, browser_connection_id)
  where status = 'active';
create index strategy_scores_user_domain_idx
  on public.strategy_scores (user_id, domain);
create index ai_request_logs_user_requested_idx
  on public.ai_request_logs (user_id, requested_at desc);
create index ai_request_logs_attempt_requested_idx
  on public.ai_request_logs (attempt_id, requested_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- The extension receives a monotonic rules version. Keeping this server-side
-- means a browser can cheaply determine when its local enforcement rules need
-- refreshing without trusting a client supplied version.
create function private.bump_rules_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  owner_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  update public.profiles
  set rules_version = rules_version + 1
  where id = owner_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- raw_user_meta_data is only used as an optional display-name convenience.
-- It is never used for authorization decisions.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(pg_catalog.left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name')), 80), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.bump_rules_version() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.valid_active_days(smallint[]) from public, anon, authenticated;
grant execute on function private.valid_active_days(smallint[]) to authenticated, service_role;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure private.set_updated_at();

create trigger restrictions_set_updated_at
before update on public.restrictions
for each row execute procedure private.set_updated_at();

create trigger restrictions_bump_rules_version
after insert or update or delete on public.restrictions
for each row execute procedure private.bump_rules_version();

create trigger browser_connections_set_updated_at
before update on public.browser_connections
for each row execute procedure private.set_updated_at();

create trigger strategy_scores_set_updated_at
before update on public.strategy_scores
for each row execute procedure private.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure private.handle_new_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.restrictions enable row level security;
alter table public.browser_connections enable row level security;
alter table public.browser_pairing_codes enable row level security;
alter table public.restriction_attempts enable row level security;
alter table public.attempt_events enable row level security;
alter table public.interventions enable row level security;
alter table public.access_sessions enable row level security;
alter table public.strategy_scores enable row level security;
alter table public.ai_request_logs enable row level security;

create policy "Users can view their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can view their own restrictions"
on public.restrictions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own restrictions"
on public.restrictions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own restrictions"
on public.restrictions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own restrictions"
on public.restrictions for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own browser connections"
on public.browser_connections for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own restriction attempts"
on public.restriction_attempts for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own attempt events"
on public.attempt_events for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own interventions"
on public.interventions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own access sessions"
on public.access_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can view their own strategy scores"
on public.strategy_scores for select
to authenticated
using ((select auth.uid()) = user_id);

-- Data API grants are explicit because Supabase projects can have either the
-- legacy public-table defaults or the newer opt-in exposure defaults. Anon is
-- denied everywhere; behavior writes, pairing, and AI audit logs are server-only.
revoke usage on schema public from anon;
grant usage on schema public to authenticated, service_role;

revoke all on table public.profiles,
  public.restrictions,
  public.browser_connections,
  public.browser_pairing_codes,
  public.restriction_attempts,
  public.attempt_events,
  public.interventions,
  public.access_sessions,
  public.strategy_scores,
  public.ai_request_logs
from anon;

revoke all on table public.profiles,
  public.restrictions,
  public.browser_connections,
  public.browser_pairing_codes,
  public.restriction_attempts,
  public.attempt_events,
  public.interventions,
  public.access_sessions,
  public.strategy_scores,
  public.ai_request_logs
from authenticated;

revoke usage on type public.coaching_tone,
  public.intervention_strategy,
  public.browser_platform,
  public.attempt_source,
  public.attempt_outcome,
  public.attempt_event_type,
  public.intervention_source,
  public.access_session_status,
  public.time_of_day_bucket,
  public.ai_request_status
from anon;

grant usage on type public.coaching_tone,
  public.intervention_strategy,
  public.browser_platform,
  public.attempt_source,
  public.attempt_outcome,
  public.attempt_event_type,
  public.intervention_source,
  public.access_session_status,
  public.time_of_day_bucket,
  public.ai_request_status
to authenticated, service_role;

grant all privileges on table public.profiles,
  public.restrictions,
  public.browser_connections,
  public.browser_pairing_codes,
  public.restriction_attempts,
  public.attempt_events,
  public.interventions,
  public.access_sessions,
  public.strategy_scores,
  public.ai_request_logs
to service_role;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.restrictions to authenticated;
grant select on table public.browser_connections to authenticated;
grant select on table public.restriction_attempts to authenticated;
grant select on table public.attempt_events to authenticated;
grant select on table public.interventions to authenticated;
grant select on table public.access_sessions to authenticated;
grant select on table public.strategy_scores to authenticated;
