-- save_employee: optional arguments get `default null` so API clients can omit
-- them (the generated types mark them optional instead of non-null strings).
-- Same body as 20261024100000; only the signature order/defaults change.

drop function public.save_employee(uuid, uuid, integer, text, text, uuid, uuid, uuid, text, jsonb, uuid[]);

-- p_employee_id null = create. p_employee_number null = keep (update) or
-- assign the next number (create). p_skills = [{"skill_id": uuid, "level": 1..3}];
-- skills and machines replace the current lists.
create function public.save_employee(
  p_org_id uuid,
  p_first_name text,
  p_last_name text,
  p_status text,
  p_skills jsonb,
  p_machine_ids uuid[],
  p_employee_id uuid default null,
  p_employee_number integer default null,
  p_department_id uuid default null,
  p_job_title_id uuid default null,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_employee_id;
  v_number integer := p_employee_number;
begin
  if not private.has_permission(p_org_id, 'employees.manage') then
    raise exception 'missing permission employees.manage' using errcode = '42501';
  end if;
  if p_skills is null or jsonb_typeof(p_skills) <> 'array' then
    raise exception 'p_skills must be a JSON array' using errcode = '22023';
  end if;

  if v_id is null then
    if v_number is null then
      -- Serialize numbering per organization.
      perform pg_advisory_xact_lock(hashtextextended('employee_number:' || p_org_id::text, 0));
      v_number := private.next_employee_number(p_org_id);
    end if;

    insert into public.employees (
      organization_id, employee_number, first_name, last_name,
      department_id, job_title_id, user_id, status
    ) values (
      p_org_id, v_number, btrim(p_first_name), btrim(p_last_name),
      p_department_id, p_job_title_id, p_user_id, p_status
    )
    returning id into v_id;
  else
    update public.employees set
      employee_number = coalesce(v_number, employee_number),
      first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      department_id = p_department_id,
      job_title_id = p_job_title_id,
      user_id = p_user_id,
      status = p_status
    where id = v_id and organization_id = p_org_id and archived_at is null;

    if not found then
      raise exception 'employee not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.employee_skills s
  where s.employee_id = v_id
    and s.skill_id not in (
      select (x ->> 'skill_id')::uuid from jsonb_array_elements(p_skills) as x
    );

  insert into public.employee_skills (organization_id, employee_id, skill_id, level)
  select p_org_id, v_id, (x ->> 'skill_id')::uuid, (x ->> 'level')::smallint
  from jsonb_array_elements(p_skills) as x
  on conflict (employee_id, skill_id) do update
    set level = excluded.level
    where public.employee_skills.level is distinct from excluded.level;

  delete from public.employee_machines em
  where em.employee_id = v_id
    and em.machine_id <> all (coalesce(p_machine_ids, '{}'));

  insert into public.employee_machines (organization_id, employee_id, machine_id)
  select p_org_id, v_id, m
  from unnest(coalesce(p_machine_ids, '{}')) as m
  on conflict (employee_id, machine_id) do nothing;

  return v_id;
end;
$$;

revoke execute on function
  public.save_employee(uuid, text, text, text, jsonb, uuid[], uuid, integer, uuid, uuid, uuid)
  from public, anon;
grant execute on function
  public.save_employee(uuid, text, text, text, jsonb, uuid[], uuid, integer, uuid, uuid, uuid)
  to authenticated;
