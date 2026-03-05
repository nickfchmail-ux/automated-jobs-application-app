# AI powered Jobs Application Engine

<p align="center">
  <a href="https://www.youtube.com/watch?v=Xw2Qw_oJgu4">
    <img src="https://img.youtube.com/vi/Xw2Qw_oJgu4/maxresdefault.jpg" alt="ai powered job application engine" width="640"/>
    <br>
    <strong>Watch the full demo (click to play)</strong>
  </a>
</p>


A Next.js app that scrapes job listings, scores them against your resume, and generates cover letters.

## Features

- **Scrape jobs** from JobsDB and CTgoodjobs by keyword
- **AI scoring** — each job is scored 0–100 for fit against your resume
- **Good Fit / Not Fit** — jobs are automatically categorised
- **Cover letter generation** — copy or download as a formatted DOCX
- **Resume management** — upload your resume (PDF/DOC/DOCX) from your profile

## Tech Stack

- [Next.js 16](https://nextjs.org/) — App Router, server components
- [Supabase](https://supabase.com/) — database & file storage
- [Tailwind CSS v4](https://tailwindcss.com/)
- [docx](https://docx.js.org/) — client-side DOCX generation

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set environment variables** — create a `.env.local` file:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_KEY=your_service_role_key
   ```

3. **Run the dev server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (bypasses RLS) |

## Note
> For expriencing fast development,
> 95% of the code in this project was written by AI spending 2 days (GitHub Copilot / Claude) with simple and modular guidances.

