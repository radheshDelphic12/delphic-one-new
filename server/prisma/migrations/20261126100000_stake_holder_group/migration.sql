-- A holder of a business can be ANOTHER holding group of the register (e.g. Gulati Industries Group holding Acconcy Finance). Null = the business's own group. Additive.
ALTER TABLE "group_company_stakes" ADD COLUMN "holder_group_id" UUID;
