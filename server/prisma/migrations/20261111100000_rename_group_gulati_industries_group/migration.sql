-- The holding group is shown as "Gulati Industries Group" (ownership picker, "Held by" chips, group views).
UPDATE "org_groups" SET "name" = 'Gulati Industries Group', "updated_at" = now() WHERE "name" = 'Delphic Group';
