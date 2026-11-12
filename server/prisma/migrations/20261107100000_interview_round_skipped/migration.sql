-- A bench profile's first interview round can be skipped (recorded as a round with result "skipped"). Additive enum value only.
ALTER TYPE "RoundResult" ADD VALUE IF NOT EXISTS 'skipped';
