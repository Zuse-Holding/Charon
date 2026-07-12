-- ============================================================
-- Statewide Executives (Political research fix #2)
-- Covers offices Congress.gov and OpenFEC have zero data on:
-- governor, lieutenant governor, attorney general, secretary of
-- state, treasurer. This pass seeds GOVERNORS ONLY (all 50 states) —
-- the other four offices (~200 more rows) are a deliberate fast-follow,
-- not rushed out here. See src/database/statewide-executives.ts.
--
-- Source: Ballotpedia's current-governors list, fetched live during
-- this session (not from model memory) — https://ballotpedia.org/
-- List_of_current_governors_in_the_United_States
-- Run this whole file once in the Supabase SQL editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS statewide_executives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL,           -- USPS 2-letter code
  office text NOT NULL,          -- 'governor' | 'lieutenant_governor' | 'attorney_general' | 'secretary_of_state' | 'treasurer'
  name text NOT NULL,
  party text,
  term_start date,
  source_url text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (state, office)
);

CREATE INDEX IF NOT EXISTS idx_statewide_executives_name ON statewide_executives (lower(name));

-- Service-role only — this table is written by hand/admin SQL, read via
-- the agent server's service-role key (src/database/statewide-executives.ts),
-- never written to from the browser, so no client-facing RLS policy is
-- required, matching the pattern used for profiles.display_name.

INSERT INTO statewide_executives (state, office, name, party, term_start, source_url) VALUES
  ('AL', 'governor', 'Kay Ivey', 'Republican', '2017-04-10', 'https://ballotpedia.org/Governor_of_Alabama'),
  ('AK', 'governor', 'Mike Dunleavy', 'Republican', '2018-12-03', 'https://ballotpedia.org/Governor_of_Alaska'),
  ('AZ', 'governor', 'Katie Hobbs', 'Democratic', '2023-01-02', 'https://ballotpedia.org/Governor_of_Arizona'),
  ('AR', 'governor', 'Sarah Huckabee Sanders', 'Republican', '2023-01-10', 'https://ballotpedia.org/Governor_of_Arkansas'),
  ('CA', 'governor', 'Gavin Newsom', 'Democratic', '2019-01-07', 'https://ballotpedia.org/Governor_of_California'),
  ('CO', 'governor', 'Jared Polis', 'Democratic', '2019-01-08', 'https://ballotpedia.org/Governor_of_Colorado'),
  ('CT', 'governor', 'Ned Lamont', 'Democratic', '2019-01-09', 'https://ballotpedia.org/Governor_of_Connecticut'),
  ('DE', 'governor', 'Matt Meyer', 'Democratic', '2025-01-21', 'https://ballotpedia.org/Governor_of_Delaware'),
  ('FL', 'governor', 'Ron DeSantis', 'Republican', '2019-01-08', 'https://ballotpedia.org/Governor_of_Florida'),
  ('GA', 'governor', 'Brian Kemp', 'Republican', '2019-01-14', 'https://ballotpedia.org/Governor_of_Georgia'),
  ('HI', 'governor', 'Joshua Green', 'Democratic', '2022-12-05', 'https://ballotpedia.org/Governor_of_Hawaii'),
  ('ID', 'governor', 'Brad Little', 'Republican', '2019-01-07', 'https://ballotpedia.org/Governor_of_Idaho'),
  ('IL', 'governor', 'J.B. Pritzker', 'Democratic', '2019-01-14', 'https://ballotpedia.org/Governor_of_Illinois'),
  ('IN', 'governor', 'Mike Braun', 'Republican', '2025-01-13', 'https://ballotpedia.org/Governor_of_Indiana'),
  ('IA', 'governor', 'Kim Reynolds', 'Republican', '2017-05-24', 'https://ballotpedia.org/Governor_of_Iowa'),
  ('KS', 'governor', 'Laura Kelly', 'Democratic', '2019-01-14', 'https://ballotpedia.org/Governor_of_Kansas'),
  ('KY', 'governor', 'Andy Beshear', 'Democratic', '2019-12-10', 'https://ballotpedia.org/Governor_of_Kentucky'),
  ('LA', 'governor', 'Jeff Landry', 'Republican', '2024-01-08', 'https://ballotpedia.org/Governor_of_Louisiana'),
  ('ME', 'governor', 'Janet T. Mills', 'Democratic', '2019-01-02', 'https://ballotpedia.org/Governor_of_Maine'),
  ('MD', 'governor', 'Wes Moore', 'Democratic', '2023-01-18', 'https://ballotpedia.org/Governor_of_Maryland'),
  ('MA', 'governor', 'Maura Healey', 'Democratic', '2023-01-05', 'https://ballotpedia.org/Governor_of_Massachusetts'),
  ('MI', 'governor', 'Gretchen Whitmer', 'Democratic', '2019-01-01', 'https://ballotpedia.org/Governor_of_Michigan'),
  ('MN', 'governor', 'Tim Walz', 'Democratic', '2019-01-07', 'https://ballotpedia.org/Governor_of_Minnesota'),
  ('MS', 'governor', 'Tate Reeves', 'Republican', '2020-01-14', 'https://ballotpedia.org/Governor_of_Mississippi'),
  ('MO', 'governor', 'Mike Kehoe', 'Republican', '2025-01-13', 'https://ballotpedia.org/Governor_of_Missouri'),
  ('MT', 'governor', 'Greg Gianforte', 'Republican', '2021-01-04', 'https://ballotpedia.org/Governor_of_Montana'),
  ('NE', 'governor', 'Jim Pillen', 'Republican', '2023-01-05', 'https://ballotpedia.org/Governor_of_Nebraska'),
  ('NV', 'governor', 'Joe Lombardo', 'Republican', '2023-01-02', 'https://ballotpedia.org/Governor_of_Nevada'),
  ('NH', 'governor', 'Kelly Ayotte', 'Republican', '2025-01-08', 'https://ballotpedia.org/Governor_of_New_Hampshire'),
  ('NJ', 'governor', 'Mikie Sherrill', 'Democratic', '2026-01-20', 'https://ballotpedia.org/Governor_of_New_Jersey'),
  ('NM', 'governor', 'Michelle Lujan Grisham', 'Democratic', '2019-01-01', 'https://ballotpedia.org/Governor_of_New_Mexico'),
  ('NY', 'governor', 'Kathy Hochul', 'Democratic', '2021-08-24', 'https://ballotpedia.org/Governor_of_New_York'),
  ('NC', 'governor', 'Josh Stein', 'Democratic', '2025-01-01', 'https://ballotpedia.org/Governor_of_North_Carolina'),
  ('ND', 'governor', 'Kelly Armstrong', 'Republican', '2024-12-15', 'https://ballotpedia.org/Governor_of_North_Dakota'),
  ('OH', 'governor', 'Mike DeWine', 'Republican', '2019-01-14', 'https://ballotpedia.org/Governor_of_Ohio'),
  ('OK', 'governor', 'Kevin Stitt', 'Republican', '2019-01-14', 'https://ballotpedia.org/Governor_of_Oklahoma'),
  ('OR', 'governor', 'Tina Kotek', 'Democratic', '2023-01-09', 'https://ballotpedia.org/Governor_of_Oregon'),
  ('PA', 'governor', 'Josh Shapiro', 'Democratic', '2023-01-17', 'https://ballotpedia.org/Governor_of_Pennsylvania'),
  ('RI', 'governor', 'Daniel McKee', 'Democratic', '2021-03-02', 'https://ballotpedia.org/Governor_of_Rhode_Island'),
  ('SC', 'governor', 'Henry McMaster', 'Republican', '2017-01-24', 'https://ballotpedia.org/Governor_of_South_Carolina'),
  ('SD', 'governor', 'Larry Rhoden', 'Republican', '2025-01-25', 'https://ballotpedia.org/Governor_of_South_Dakota'),
  ('TN', 'governor', 'Bill Lee', 'Republican', '2019-01-15', 'https://ballotpedia.org/Governor_of_Tennessee'),
  ('TX', 'governor', 'Greg Abbott', 'Republican', '2015-01-20', 'https://ballotpedia.org/Governor_of_Texas'),
  ('UT', 'governor', 'Spencer Cox', 'Republican', '2021-01-04', 'https://ballotpedia.org/Governor_of_Utah'),
  ('VT', 'governor', 'Phil Scott', 'Republican', '2017-01-05', 'https://ballotpedia.org/Governor_of_Vermont'),
  ('VA', 'governor', 'Abigail Spanberger', 'Democratic', '2026-01-17', 'https://ballotpedia.org/Governor_of_Virginia'),
  ('WA', 'governor', 'Bob Ferguson', 'Democratic', '2025-01-13', 'https://ballotpedia.org/Governor_of_Washington'),
  ('WV', 'governor', 'Patrick Morrisey', 'Republican', '2025-01-13', 'https://ballotpedia.org/Governor_of_West_Virginia'),
  ('WI', 'governor', 'Tony Evers', 'Democratic', '2019-01-07', 'https://ballotpedia.org/Governor_of_Wisconsin'),
  ('WY', 'governor', 'Mark Gordon', 'Republican', '2019-01-07', 'https://ballotpedia.org/Governor_of_Wyoming')
ON CONFLICT (state, office) DO UPDATE SET
  name = EXCLUDED.name,
  party = EXCLUDED.party,
  term_start = EXCLUDED.term_start,
  source_url = EXCLUDED.source_url,
  updated_at = now();
