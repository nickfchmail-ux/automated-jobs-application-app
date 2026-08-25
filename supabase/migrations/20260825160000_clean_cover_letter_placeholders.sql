-- =====================================================================
-- Defensive cleanup: strip LLM/editor placeholder junk from cover letters
--
-- Some legacy generated cover letters can contain tokens like
-- "#attachment:Pasted text #1", markdown image embeds, or "[attachment…]"
-- that leaked from an editing/LLM tool. These should never reach the user.
-- This migration scrubs any such tokens from the stored cover_letter text.
-- =====================================================================

update public.jobs
set cover_letter = regexp_replace(
      cover_letter,
      '(#attachment:[^\n]*|!\[[^\]]*\]\([^)]*\)|\[(attachment|image|paste)[^\]]*\]|```[\s\S]*?```)',
      '',
      'g'
    ),
    updated_at = now()
where cover_letter is not null
  and (
    cover_letter ~* '#\s*attachment'
    or cover_letter ~* 'pasted?\s*text'
    or cover_letter ~* '\[(attachment|image|paste)'
    or cover_letter ~* '```'
  );
