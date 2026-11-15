alter table public.raffles drop constraint if exists raffles_funding_source_check;
alter table public.raffles add constraint raffles_funding_source_check check (funding_source in ('treasury','external','agent_inventory'));
