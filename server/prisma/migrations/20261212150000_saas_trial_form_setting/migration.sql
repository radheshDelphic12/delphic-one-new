-- SaaS launch, phase 3: the public "Request a trial" form is closed until a platform admin opens it (platform setting, 1 = open, 0 = closed).
INSERT INTO "saas_settings" ("key", "value", "note") VALUES ('trial_form_open', '0'::jsonb, 'Public trial request form on the website: 1 = accepting requests, 0 = closed');
