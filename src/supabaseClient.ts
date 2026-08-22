import { createClient } from '@supabase/supabase-js';

// Supabase configuration for the dental clinic app
// Using the new Publishable Key format or legacy anon key
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xdrvhkmritmcgyquynov.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_dvgVA5b9-mtvHZbtWfsixg_2fdx100';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
