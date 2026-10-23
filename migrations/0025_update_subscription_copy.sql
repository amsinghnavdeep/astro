UPDATE blog_posts
SET body = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(body, 'Your first question is free.', 'Personal plans include 7 days free, 2 consultations, and cancellation anytime.'),
        'your first question is free', 'Personal plans include 7 days free and 2 consultations'
      ),
      'First question free.', 'Personal plans include 7 days free, 2 consultations, and cancellation anytime.'
    ),
    'No subscription.', ''
  ),
  'Get your free first answer', 'See Personal plans'
),
updated_at = datetime('now')
WHERE lower(body) LIKE '%first question%free%'
   OR lower(body) LIKE '%no subscription%'
   OR lower(body) LIKE '%free first answer%';
