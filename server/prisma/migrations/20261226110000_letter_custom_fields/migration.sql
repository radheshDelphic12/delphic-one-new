-- HR letter templates can define their own fields (typed by HR when the letter is issued).
ALTER TABLE "letter_templates" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '[]';
