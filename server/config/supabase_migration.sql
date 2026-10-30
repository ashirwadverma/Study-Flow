-- ====================================================================
-- StudyFlow: Supabase Database Migration for `subjects` Table
-- Run this script in the Supabase Dashboard -> SQL Editor
-- ====================================================================

-- 1. Enable pgcrypto for UUID generation (standard in Postgres/Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create the `subjects` table
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    description TEXT,
    color TEXT DEFAULT '#4F46E5',
    target_hours NUMERIC DEFAULT 0 CHECK (target_hours >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create indices for fast user queries and sorting
CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON public.subjects(user_id);
CREATE INDEX IF NOT EXISTS idx_subjects_created_at ON public.subjects(created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies
-- SELECT: Users can only view their own subjects
DROP POLICY IF EXISTS "Users can view their own subjects" ON public.subjects;
CREATE POLICY "Users can view their own subjects"
    ON public.subjects
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- INSERT: Users can only insert subjects for themselves
DROP POLICY IF EXISTS "Users can insert their own subjects" ON public.subjects;
CREATE POLICY "Users can insert their own subjects"
    ON public.subjects
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own subjects
DROP POLICY IF EXISTS "Users can update their own subjects" ON public.subjects;
CREATE POLICY "Users can update their own subjects"
    ON public.subjects
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can only delete their own subjects
DROP POLICY IF EXISTS "Users can delete their own subjects" ON public.subjects;
CREATE POLICY "Users can delete their own subjects"
    ON public.subjects
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- 6. Trigger for automatic updated_at timestamp updates
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_timestamp ON public.subjects;
CREATE TRIGGER trigger_set_timestamp
    BEFORE UPDATE ON public.subjects
    FOR EACH ROW
    EXECUTE FUNCTION public.set_current_timestamp_updated_at();

