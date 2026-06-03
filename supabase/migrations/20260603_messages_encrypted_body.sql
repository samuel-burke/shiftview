-- The messages.body column now stores AES-256-GCM ciphertext, which is longer
-- than the original plaintext. Drop the 2000-char upper bound from the DB
-- constraint; plaintext length is still validated at the API layer (≤ 2000 chars).
alter table messages
  drop constraint if exists messages_body_check,
  add constraint messages_body_check check (char_length(body) > 0);
