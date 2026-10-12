-- Local development seed: a few public job boards to ingest. Production sources are
-- managed by an admin script seeded from employers in DOL LCA data (ARCHITECTURE.md section 7).
insert into jobs.companies (name, normalized_name, website) values
  ('Stripe', 'stripe', 'https://stripe.com'),
  ('Airbnb', 'airbnb', 'https://airbnb.com'),
  ('Palantir Technologies', 'palantir technologies', 'https://palantir.com'),
  ('Ramp', 'ramp', 'https://ramp.com')
on conflict (normalized_name) do nothing;

insert into jobs.sources (kind, token, company_id)
select v.kind, v.token, c.id
from (values
  ('greenhouse', 'stripe', 'stripe'),
  ('greenhouse', 'airbnb', 'airbnb'),
  ('lever', 'palantir', 'palantir technologies'),
  ('ashby', 'ramp', 'ramp')
) as v(kind, token, company)
join jobs.companies c on c.normalized_name = v.company
on conflict (kind, token) do nothing;
