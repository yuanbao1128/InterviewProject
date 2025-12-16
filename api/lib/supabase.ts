import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'resumes';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export { STORAGE_BUCKET };