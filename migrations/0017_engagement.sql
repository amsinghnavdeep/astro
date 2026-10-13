-- Festival deals (dates from Drik Panchang, New Delhi), email unsubscribe and a send log for reminder/marketing emails.
CREATE TABLE festivals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  festival_date TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  percent INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX festivals_window ON festivals (starts_on, ends_on);
INSERT INTO festivals (id, name, festival_date, starts_on, ends_on) VALUES
  ('navratri-2026', 'Navratri', '2026-10-11', '2026-10-10', '2026-10-12'),
  ('dussehra-2026', 'Dussehra', '2026-10-20', '2026-10-19', '2026-10-21'),
  ('diwali-2026', 'Diwali', '2026-11-08', '2026-11-07', '2026-11-09'),
  ('makar-sankranti-2027', 'Makar Sankranti', '2027-01-15', '2027-01-14', '2027-01-16'),
  ('maha-shivaratri-2027', 'Maha Shivaratri', '2027-03-06', '2027-03-05', '2027-03-07'),
  ('holi-2027', 'Holi', '2027-03-22', '2027-03-21', '2027-03-23'),
  ('ram-navami-2027', 'Ram Navami', '2027-04-15', '2027-04-14', '2027-04-16'),
  ('akshaya-tritiya-2027', 'Akshaya Tritiya', '2027-05-09', '2027-05-08', '2027-05-10'),
  ('raksha-bandhan-2027', 'Raksha Bandhan', '2027-08-17', '2027-08-16', '2027-08-18'),
  ('janmashtami-2027', 'Janmashtami', '2027-08-25', '2027-08-24', '2027-08-26'),
  ('ganesh-chaturthi-2027', 'Ganesh Chaturthi', '2027-09-04', '2027-09-03', '2027-09-05'),
  ('navratri-2027', 'Navratri', '2027-09-30', '2027-09-29', '2027-10-01'),
  ('dussehra-2027', 'Dussehra', '2027-10-09', '2027-10-08', '2027-10-10'),
  ('diwali-2027', 'Diwali', '2027-10-29', '2027-10-28', '2027-10-30');

ALTER TABLE users ADD COLUMN email_unsub INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN unsub_token TEXT;
CREATE UNIQUE INDEX users_unsub_token ON users (unsub_token);

CREATE TABLE email_log (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);
