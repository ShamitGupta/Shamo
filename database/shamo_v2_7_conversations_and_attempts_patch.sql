begin;

-- Shamo v2.7: persisted conversations and recorded student attempts.
--
-- Until now a conversation lived only in React state and a student's submitted
-- working was read by Check mode and then discarded. This adds the three tables
-- that make the tutor remember, and that every later personalisation feature
-- reads from.
--
-- Additive only. Nothing here touches published academic content.
--
-- On question identity: a question's STABLE identity in this system is the
-- reference tuple (qualification, syllabus_code, year, exam_session,
-- paper_variant, question_number) -- that is how the API addresses questions and
-- how a student navigates to one. shamo_questions.id is a convenience link that
-- can legitimately change when a paper is corrected and republished, so it is
-- nullable with "on delete set null" while the reference tuple is stored
-- not-null. Republishing a corrected paper must never silently destroy a
-- student's record of having attempted that question.

create table if not exists public.shamo_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Display-only denormalization so the thread list needs no per-thread
  -- aggregate. Maintained on append; the turns table remains the truth.
  turn_count integer not null default 0,
  last_question jsonb,
  constraint shamo_conversations_title_not_blank
    check (title is null or btrim(title) <> ''),
  constraint shamo_conversations_title_length
    check (title is null or length(title) <= 120)
);

comment on table public.shamo_conversations is
  'One student tutoring thread. A thread may span several questions.';
comment on column public.shamo_conversations.title is
  'Student-chosen name. Null means the client renders a date-derived label instead.';
comment on column public.shamo_conversations.deleted_at is
  'Reserved for an operator-side archive action. The student-facing delete is a REAL delete -- keeping a hidden copy of a student own written working after they asked for it to go is the wrong trade. Read paths honour this column; nothing in the student path sets it.';
comment on column public.shamo_conversations.turn_count is
  'Advisory display counter maintained on append. Display-only: the turns table is the truth.';
comment on column public.shamo_conversations.last_question is
  'Display hint -- the question reference of the most recent turn. Not an identity; a thread may span many questions.';

create table if not exists public.shamo_conversation_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.shamo_conversations(id) on delete cascade,
  -- Denormalized from the parent conversation so an own-row policy and a
  -- per-user index do not need a join on every read.
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null default '',
  modes text[] not null default '{}',
  visual_artifacts jsonb,
  sort_order integer not null,

  -- Which question this turn was about. This is what makes a multi-question
  -- thread safe: without it the tutor could read turns about question 4 while
  -- holding question 7's mark scheme, with no way to tell them apart.
  question_id uuid references public.shamo_questions(id) on delete set null,
  qualification text,
  syllabus_code text,
  year smallint,
  exam_session text,
  paper_variant text,
  question_number integer,

  created_at timestamptz not null default now(),

  constraint shamo_conversation_turns_role_known
    check (role in ('user', 'assistant')),
  constraint shamo_conversation_turns_sort_order_positive
    check (sort_order >= 0),
  constraint shamo_conversation_turns_session_known
    check (exam_session is null or exam_session in ('feb_march', 'may_june', 'oct_nov')),
  -- A turn either carries a complete question reference or none at all. A
  -- partial reference cannot be resolved, and would silently drop out of every
  -- later aggregate rather than failing loudly.
  constraint shamo_conversation_turns_reference_complete
    check (
      (qualification is null and syllabus_code is null and year is null
        and exam_session is null and paper_variant is null and question_number is null)
      or (qualification is not null and syllabus_code is not null and year is not null
        and exam_session is not null and paper_variant is not null and question_number is not null)
    ),
  constraint shamo_conversation_turns_unique_position
    unique (conversation_id, sort_order)
);

comment on table public.shamo_conversation_turns is
  'One message in a thread, tagged with the question it was about.';
comment on column public.shamo_conversation_turns.question_id is
  'Convenience link only. The reference columns are the stable identity -- see the file header.';
comment on column public.shamo_conversation_turns.modes is
  'Tutor mode(s) that produced an assistant turn. Empty for student turns.';

create table if not exists public.shamo_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  question_id uuid references public.shamo_questions(id) on delete set null,
  qualification text not null,
  syllabus_code text not null,
  year smallint not null,
  exam_session text not null,
  paper_variant text not null,
  question_number integer not null,
  part_label text,

  -- Nullable and "on delete set null": deleting a conversation must not destroy
  -- the mark record, but while that conversation exists this is what makes
  -- "show me where that happened" possible. It cannot be backfilled later.
  conversation_turn_id uuid
    references public.shamo_conversation_turns(id) on delete set null,

  attempt_text text not null,
  mode text not null default 'check',

  marks_earned integer,
  marks_available integer,
  earned_codes text[] not null default '{}',
  missed_codes text[] not null default '{}',

  outcome_source text not null default 'unavailable',
  extractor_model text,
  extractor_confidence real,

  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint shamo_attempts_session_known
    check (exam_session in ('feb_march', 'may_june', 'oct_nov')),
  constraint shamo_attempts_text_not_blank
    check (btrim(attempt_text) <> ''),
  constraint shamo_attempts_outcome_source_known
    check (outcome_source in ('extractor', 'unavailable')),
  constraint shamo_attempts_marks_sane
    check (
      (marks_earned is null and marks_available is null)
      or (marks_earned >= 0 and marks_available > 0 and marks_earned <= marks_available)
    ),
  -- An outcome is either fully present or absent. A half-recorded outcome would
  -- be read as a genuine zero by every later aggregate.
  constraint shamo_attempts_outcome_complete
    check (
      (outcome_source = 'unavailable' and marks_earned is null)
      or (outcome_source = 'extractor' and marks_earned is not null)
    ),
  constraint shamo_attempts_confidence_range
    check (extractor_confidence is null
      or (extractor_confidence >= 0 and extractor_confidence <= 1))
);

comment on table public.shamo_attempts is
  'One submitted student attempt and the marks it was judged to earn.';
comment on column public.shamo_attempts.outcome_source is
  'extractor = a marking outcome was produced and validated; unavailable = the tutoring succeeded but no outcome could be recorded.';
comment on column public.shamo_attempts.earned_codes is
  'Mark codes validated against that question own mark scheme. A code the mark scheme does not contain is discarded, never stored.';

create index if not exists shamo_conversations_user_recent_idx
  on public.shamo_conversations (user_id, last_active_at desc)
  where deleted_at is null;

create index if not exists shamo_conversation_turns_thread_idx
  on public.shamo_conversation_turns (conversation_id, sort_order);

create index if not exists shamo_attempts_user_recent_idx
  on public.shamo_attempts (user_id, created_at desc)
  where deleted_at is null;

create index if not exists shamo_attempts_user_question_idx
  on public.shamo_attempts (user_id, question_id)
  where deleted_at is null;

-- Access. The browser has no direct privileges on any of these tables, exactly
-- as it has none on published content: backend_v2 is the only read path, and it
-- filters every query by the authenticated user's id. The own-row policies below
-- are therefore defence in depth rather than today's enforcement -- they exist so
-- that granting direct access later cannot accidentally expose another student's
-- work.
alter table public.shamo_conversations enable row level security;
alter table public.shamo_conversation_turns enable row level security;
alter table public.shamo_attempts enable row level security;

revoke all on table public.shamo_conversations from anon, authenticated;
revoke all on table public.shamo_conversation_turns from anon, authenticated;
revoke all on table public.shamo_attempts from anon, authenticated;

drop policy if exists "Users can read own conversations" on public.shamo_conversations;
create policy "Users can read own conversations"
on public.shamo_conversations
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own conversation turns" on public.shamo_conversation_turns;
create policy "Users can read own conversation turns"
on public.shamo_conversation_turns
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own attempts" on public.shamo_attempts;
create policy "Users can read own attempts"
on public.shamo_attempts
for select
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on table public.shamo_conversations to service_role;
grant select, insert, update, delete on table public.shamo_conversation_turns to service_role;
grant select, insert, update, delete on table public.shamo_attempts to service_role;

commit;
