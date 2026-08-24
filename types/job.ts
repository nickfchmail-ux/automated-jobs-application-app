export type job = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  posted_date: string;
  url: string;
  short_description: string;
  keyword: string;
  scraped_date: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  skills: string[];
  employment_type: null;
  experience_level: string;
  about_company: unknown;
  raw_description: string;
  fit: boolean;
  fit_score: number;
  fit_reasons: string[];
  /** Why the score — plain-language justification from the evaluator. */
  justification?: string | null;
  /** Specific reasons it is NOT a fit (what's missing from the resume). */
  not_fit_reasons?: string[] | null;
  cover_letter: string;
  expected_salary: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  search_key: string;
  applied: boolean;
  interested_in: boolean | null;
  /** New platform columns */
  status?: string | null;
  board?: string | null;
  pipeline_run_id?: string | null;
  resume_status?: string | null;
  resume_url?: string | null;
  resume_pdf_url?: string | null;
  /** Tailored-resume build failure (Story B). */
  resume_error?: string | null;
  /** AI evaluation fields (written back by the evaluator microservice). */
  evaluation_status?: string | null;
};
