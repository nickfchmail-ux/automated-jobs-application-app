-- ============================================================
--  FIX: get_user_insights — meaningful gaps (corrected regexp split)
--
--  Re-applies the function so strengths/gaps produce real missing
--  skills (Java, C#, Flutter, Spring Boot…) instead of "no
--  experience"/"the job"/"lacks the". The whitespace split now uses
--  E'\\s+' (escape string) so \s = whitespace in Postgres.
-- ============================================================

create or replace function public.get_user_insights(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_user_id is null then
    return '{}'::jsonb;
  end if;

  with stopwords as (
    select unnest(array[
      'the','and','with','for','in','of','no','a','an','to','on','is','are','as','or','at','be','not',
      'which','that','this','their','his','her','its',
      'experience','expertise','skills','skill','knowledge','strong','good','working','hands','related',
      'proficiency','proficient','relevant','years','year','role','jobs','job','work','development',
      'developer','engineer','requirement','requirements','candidate','position','company','team','ability',
      'background','demonstrated','demonstrates','proven','requires','required','including','provide','based'
    ]) as word
  ),
  j as (
    select
      id, fit, fit_score, fit_reasons, not_fit_reasons,
      applied, interested_in, board, search_key, status,
      resume_status, cover_letter_status, pipeline_run_id,
      title, company, justification, expected_salary,
      salary_min, salary_max, salary_currency, salary_period,
      created_at
    from public.jobs
    where user_id = p_user_id
  ),
  evaluated as (
    select * from j where fit is not null
  ),
  matches as (
    select * from evaluated where fit = true
  ),
  notfit as (
    select * from evaluated where fit = false
  ),
  -- ── Strengths: capitalized tech phrases, first+last stopword check ──
  strength_raw as (
    select
      t[1] as phrase,
      (regexp_split_to_array(t[1], E'\\s+'))[1] as first_w,
      (regexp_split_to_array(t[1], E'\\s+'))[
        array_length(regexp_split_to_array(t[1], E'\\s+'), 1)
      ] as last_w
    from matches m,
    lateral jsonb_array_elements_text(coalesce(m.fit_reasons, '[]'::jsonb)) r,
    lateral regexp_matches(r, '([A-Z][A-Za-z0-9+#.]+(?: [A-Za-z][A-Za-z0-9+#.]+)?)', 'g') t
  ),
  strength_tokens as (
    select sr.phrase as term
    from strength_raw sr
    where length(sr.phrase) >= 2
      and length(lower(sr.first_w)) >= 2
      and not exists (select 1 from stopwords s where s.word = lower(sr.first_w))
      and not exists (select 1 from stopwords s where s.word = lower(sr.last_w))
  ),
  strength_grouped as (
    select term, count(*) as cnt
    from strength_tokens
    group by term
    order by cnt desc
    limit 6
  ),
  -- ── Gaps: same faithful logic on not_fit_reasons ──
  gap_raw as (
    select
      t[1] as phrase,
      (regexp_split_to_array(t[1], E'\\s+'))[1] as first_w,
      (regexp_split_to_array(t[1], E'\\s+'))[
        array_length(regexp_split_to_array(t[1], E'\\s+'), 1)
      ] as last_w
    from notfit n,
    lateral jsonb_array_elements_text(coalesce(n.not_fit_reasons, '[]'::jsonb)) r,
    lateral regexp_matches(r, '([A-Z][A-Za-z0-9+#.]+(?: [A-Za-z][A-Za-z0-9+#.]+)?)', 'g') t
  ),
  gap_tokens as (
    select gr.phrase as term
    from gap_raw gr
    where length(gr.phrase) >= 2
      and length(lower(gr.first_w)) >= 2
      and not exists (select 1 from stopwords s where s.word = lower(gr.first_w))
      and not exists (select 1 from stopwords s where s.word = lower(gr.last_w))
  ),
  gap_grouped as (
    select term, count(*) as cnt
    from gap_tokens
    group by term
    order by cnt desc
    limit 6
  ),
  -- ── Score buckets ──
  buckets as (
    select
      count(*) filter (where fit_score >= 75) as great,
      count(*) filter (where fit_score >= 50 and fit_score < 75) as possible,
      count(*) filter (where fit_score < 50) as low,
      count(*) as total
    from evaluated
  ),
  -- ── Salary: normalize to monthly HKD over MATCHES with a range ──
  salary_norm as (
    select
      case
        when coalesce(salary_period, 'month') in ('year', 'annual') then
          ((salary_min::numeric + salary_max::numeric) / 2) / 12
        when coalesce(salary_period, 'month') in ('hour', 'hr') then
          ((salary_min::numeric + salary_max::numeric) / 2) * 160
        else
          (salary_min::numeric + salary_max::numeric) / 2
      end as monthly,
      search_key, board
    from matches
    where salary_min is not null and salary_max is not null
      and salary_min > 0 and salary_max > 0
      and salary_currency = 'HKD'
  ),
  salary_stats as (
    select
      count(*) as with_salary,
      percentile_cont(0.5) within group (order by monthly) as median,
      round(avg(monthly)) as avg,
      array_agg(monthly) as vals
    from salary_norm
  ),
  salary_top_kw as (
    select search_key as keyword, round(avg(monthly)) as avg_monthly, count(*) as cnt
    from salary_norm
    where search_key is not null
    group by search_key
    order by avg_monthly desc
    limit 5
  ),
  salary_top_board as (
    select board, round(avg(monthly)) as avg_monthly, count(*) as cnt
    from salary_norm
    where board is not null
    group by board
    order by avg_monthly desc
    limit 5
  ),
  -- ── Trend: by run, oldest → newest, up to 8 ──
  run_scores as (
    select
      pipeline_run_id,
      search_key,
      avg(fit_score)::numeric as avg_score,
      count(*) as cnt
    from evaluated
    group by pipeline_run_id, search_key
    order by min(created_at)
    limit 8
  ),
  -- ── Board + keyword fit mix ──
  board_mix as (
    select
      coalesce(board, 'other') as board,
      count(*) as evaluated,
      count(*) filter (where fit = true) as matches
    from evaluated
    group by coalesce(board, 'other')
    order by evaluated desc
    limit 6
  ),
  kw_mix as (
    select
      coalesce(search_key, 'general') as keyword,
      count(*) as evaluated,
      count(*) filter (where fit = true) as matches
    from evaluated
    group by coalesce(search_key, 'general')
    having count(*) > 0
    order by (count(*) filter (where fit = true)::numeric / count(*)) desc
    limit 6
  ),
  -- ── Top matches (strongest fit) ──
  top_matches as (
    select
      id, title, company, fit_score,
      coalesce(justification, '') as justification,
      coalesce(expected_salary, '') as salary,
      applied, board, search_key,
      cover_letter_status = 'completed' as cover_letter_done
    from matches
    order by fit_score desc nulls last
    limit 6
  ),
  -- ── Momentum / totals ──
  counts as (
    select
      (select count(*) from j) as scraped,
      (select count(*) from evaluated) as evaluated,
      (select count(*) from matches) as matches,
      (select count(*) from notfit) as not_fit,
      (select count(*) from j where applied = true) as applied,
      (select count(*) from j where interested_in = false) as not_interested,
      (select count(*) from j where cover_letter_status = 'completed') as total_letters,
      (select count(*) from matches where cover_letter_status = 'completed') as letters_on_matches,
      (select count(*) from j where resume_status = 'completed') as resume_done,
      (select count(*) from j where status = 'duplicate') as duplicate,
      (select count(*) from j where interested_in is not false) as reviewed
  ),
  scores as (
    select
      round(avg(fit_score)) as avg_fit,
      percentile_cont(0.5) within group (order by fit_score) as median_fit
    from evaluated
    where fit_score is not null
  )

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'scraped', c.scraped,
      'evaluated', c.evaluated,
      'reviewed', c.reviewed,
      'matches', c.matches,
      'notFit', c.not_fit,
      'applied', c.applied,
      'resumeBuilt', c.resume_done,
      'coverLetterBuilt', c.letters_on_matches,
      'duplicate', c.duplicate
    ),
    'avgFitScore', coalesce(sc.avg_fit, 0),
    'medianFitScore', coalesce(sc.median_fit, 0),
    'strengths', coalesce((select jsonb_agg(jsonb_build_object(
        'term', term, 'count', cnt,
        'share', round(cnt::numeric / greatest(1, (select count(*) from matches)), 4)
      )) from strength_grouped), '[]'::jsonb),
    'gaps', coalesce((select jsonb_agg(jsonb_build_object(
        'term', term, 'count', cnt,
        'share', round(cnt::numeric / greatest(1, (select count(*) from notfit)), 4)
      )) from gap_grouped), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object(
        'label', coalesce(nullif(search_key, ''), 'Run'),
        'avgScore', round(avg_score),
        'count', cnt
      )) from run_scores), '[]'::jsonb),
    'byBoard', coalesce((select jsonb_agg(jsonb_build_object(
        'board', board, 'evaluated', evaluated, 'matches', matches,
        'fitRate', case when evaluated > 0 then round(matches::numeric / evaluated * 100) else 0 end
      )) from board_mix), '[]'::jsonb),
    'byKeyword', coalesce((select jsonb_agg(jsonb_build_object(
        'keyword', keyword, 'evaluated', evaluated, 'matches', matches,
        'fitRate', case when evaluated > 0 then round(matches::numeric / evaluated * 100) else 0 end
      )) from kw_mix), '[]'::jsonb),
    'scoreBuckets', jsonb_build_object(
      'great', b.great, 'possible', b.possible, 'low', b.low, 'total', b.total
    ),
    'salary', jsonb_build_object(
      'medianMonthly', coalesce(round(s.median), 0),
      'avgMonthly', coalesce(s.avg, 0),
      'withSalary', coalesce(s.with_salary, 0),
      'distribution', jsonb_build_array(
        jsonb_build_object('label', '≤ 15k', 'count', (select count(*) from unnest(s.vals) v where v <= 15000)),
        jsonb_build_object('label', '15–25k', 'count', (select count(*) from unnest(s.vals) v where v > 15000 and v <= 25000)),
        jsonb_build_object('label', '25–40k', 'count', (select count(*) from unnest(s.vals) v where v > 25000 and v <= 40000)),
        jsonb_build_object('label', '40–60k', 'count', (select count(*) from unnest(s.vals) v where v > 40000 and v <= 60000)),
        jsonb_build_object('label', '60k+', 'count', (select count(*) from unnest(s.vals) v where v > 60000))
      ),
      'topByKeyword', coalesce((select jsonb_agg(jsonb_build_object('keyword', keyword, 'avgMonthly', avg_monthly, 'count', cnt)) from salary_top_kw), '[]'::jsonb),
      'topByBoard', coalesce((select jsonb_agg(jsonb_build_object('board', board, 'avgMonthly', avg_monthly, 'count', cnt)) from salary_top_board), '[]'::jsonb)
    ),
    'topMatches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'title', title, 'company', company, 'fitScore', fit_score,
        'justification', justification, 'salary', salary, 'applied', applied,
        'board', board, 'searchKey', search_key, 'coverLetterDone', cover_letter_done
      )) from top_matches), '[]'::jsonb),
    'momentum', jsonb_build_object(
      'applied', c.applied,
      'appliedRate', case when c.matches > 0 then round(c.applied::numeric / c.matches * 100) else 0 end,
      'notInterested', c.not_interested,
      'matchesNotApplied', c.matches - c.applied,
      'coverLetterDone', c.letters_on_matches,
      'totalLetters', c.total_letters,
      'coverLetterRate', case when c.matches > 0 then round(c.letters_on_matches::numeric / c.matches * 100) else 0 end,
      'resumeDone', c.resume_done
    )
  )
  into result
  from counts c, scores sc, buckets b, salary_stats s;

  return result;
end;
$$;

revoke all on function public.get_user_insights(uuid) from public;
grant execute on function public.get_user_insights(uuid) to service_role, authenticated;
