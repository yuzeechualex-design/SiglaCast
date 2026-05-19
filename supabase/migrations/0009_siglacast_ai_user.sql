-- Sentinel user for SiglaCast AI replies posted into message threads.

insert into public.users (id, role, name, email, password_hash, course)
values (
  '_siglacast_ai',
  'student',
  'SiglaCast AI',
  'siglacast.ai.internal',
  '$2a$10$________________________________________________________________',
  ''
)
on conflict (id) do nothing;
