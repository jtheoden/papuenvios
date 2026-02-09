-- Clean up duplicate testimonials: keep only the most recent per user
DELETE FROM public.testimonials
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM public.testimonials
  ORDER BY user_id, created_at DESC
);

-- Ensure each user can only submit one testimonial
CREATE UNIQUE INDEX IF NOT EXISTS testimonials_user_id_unique ON public.testimonials (user_id);
