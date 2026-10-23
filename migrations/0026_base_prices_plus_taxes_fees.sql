UPDATE blog_posts
SET body = replace(body, '$11.50', '$10 + taxes & fees'),
    summary = replace(summary, '$11.50', '$10 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$11.50%' OR summary LIKE '%$11.50%';

UPDATE blog_posts
SET body = replace(body, '$10.35', '$9 + taxes & fees'),
    summary = replace(summary, '$10.35', '$9 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$10.35%' OR summary LIKE '%$10.35%';

UPDATE blog_posts
SET body = replace(body, '$8.05', '$7 + taxes & fees'),
    summary = replace(summary, '$8.05', '$7 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$8.05%' OR summary LIKE '%$8.05%';

UPDATE blog_posts
SET body = replace(body, '$7.25', '$6.30 + taxes & fees'),
    summary = replace(summary, '$7.25', '$6.30 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$7.25%' OR summary LIKE '%$7.25%';

UPDATE blog_posts
SET body = replace(body, '$3.15', '$3.15 + taxes & fees'),
    summary = replace(summary, '$3.15', '$3.15 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$3.15%' OR summary LIKE '%$3.15%';

UPDATE blog_posts
SET body = replace(body, '$115', '$100 + taxes & fees'),
    summary = replace(summary, '$115', '$100 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$115%' OR summary LIKE '%$115%';

UPDATE blog_posts
SET body = replace(body, '$287.50', '$250 + taxes & fees'),
    summary = replace(summary, '$287.50', '$250 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$287.50%' OR summary LIKE '%$287.50%';

UPDATE blog_posts
SET body = replace(body, '$575', '$500 + taxes & fees'),
    summary = replace(summary, '$575', '$500 + taxes & fees'),
    updated_at = datetime('now')
WHERE body LIKE '%$575%' OR summary LIKE '%$575%';

UPDATE blog_posts
SET body = replace(replace(body, 'taxes & fees included', 'before taxes & fees'), 'incl. taxes & fees', '+ taxes & fees'),
    summary = replace(replace(summary, 'taxes & fees included', 'before taxes & fees'), 'incl. taxes & fees', '+ taxes & fees'),
    updated_at = datetime('now')
WHERE lower(body) LIKE '%taxes & fees included%' OR lower(body) LIKE '%incl. taxes & fees%'
   OR lower(summary) LIKE '%taxes & fees included%' OR lower(summary) LIKE '%incl. taxes & fees%';
