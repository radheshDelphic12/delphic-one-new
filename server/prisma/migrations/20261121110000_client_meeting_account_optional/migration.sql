-- Additive/relaxing only: a trip meeting scheduled from the Group Dashboard need not be tied to a client or vendor.
ALTER TABLE "client_meetings" ALTER COLUMN "account_id" DROP NOT NULL;
