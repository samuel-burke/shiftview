import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { requireManager } from "@/lib/require-manager";
import { writeAuditLog } from "@/lib/audit";
import { validateBlocks, CoverageBlock } from "@/lib/coverage";
import { DEMO_COVERAGE_PROFILES } from "@/data/demo-fixtures";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 60;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json(DEMO_COVERAGE_PROFILES);

  const [{ data: profiles, error: profilesError }, { data: blocks, error: blocksError }] = await Promise.all([
    supabase.from("coverage_profiles").select("id, name").order("name"),
    supabase.from("coverage_profile_blocks").select("profile_id, start_minutes, end_minutes, headcount").order("start_minutes"),
  ]);

  if (profilesError || blocksError) {
    console.error("[api/coverage-profiles]", profilesError ?? blocksError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const byProfile = new Map<number, CoverageBlock[]>();
  for (const b of blocks ?? []) {
    if (!byProfile.has(b.profile_id)) byProfile.set(b.profile_id, []);
    byProfile.get(b.profile_id)!.push({
      startMinutes: b.start_minutes,
      endMinutes:   b.end_minutes,
      headcount:    b.headcount,
    });
  }

  return NextResponse.json(
    (profiles ?? []).map((p) => ({ id: p.id, name: p.name, blocks: byProfile.get(p.id) ?? [] }))
  );
}

export async function POST(request: Request) {
  const { name, blocks = [] } = await request.json();

  if (typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.trim().length > MAX_NAME_LENGTH)
    return NextResponse.json({ error: `name must be at most ${MAX_NAME_LENGTH} characters` }, { status: 400 });
  const blocksError = validateBlocks(blocks);
  if (blocksError) return NextResponse.json({ error: blocksError }, { status: 422 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: created, error: insertError } = await supabase
    .from("coverage_profiles")
    .insert({ name: name.trim() })
    .select("id")
    .single();

  if (insertError || !created) {
    if (insertError?.code === "23505")
      return NextResponse.json({ error: "A profile with this name already exists" }, { status: 409 });
    console.error("[api/coverage-profiles]", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if ((blocks as CoverageBlock[]).length > 0) {
    const { error: blocksInsertError } = await supabase
      .from("coverage_profile_blocks")
      .insert((blocks as CoverageBlock[]).map((b) => ({
        profile_id:    created.id,
        start_minutes: b.startMinutes,
        end_minutes:   b.endMinutes,
        headcount:     b.headcount,
      })));
    if (blocksInsertError) {
      console.error("[api/coverage-profiles]", blocksInsertError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  writeAuditLog({
    action:       "coverage_profile.create",
    actorId:      user?.id,
    resourceType: "coverage_profile",
    resourceId:   String(created.id),
    after: { name: name.trim(), blocks },
    metadata: { name: name.trim(), blockCount: (blocks as CoverageBlock[]).length },
  }).catch(() => {});

  return NextResponse.json({ id: created.id }, { status: 201 });
}

export async function PUT(request: Request) {
  const { id, name, blocks } = await request.json();

  if (id == null || !Number.isInteger(id))
    return NextResponse.json({ error: "id required" }, { status: 400 });
  if (name === undefined && blocks === undefined)
    return NextResponse.json({ error: "name or blocks required" }, { status: 400 });
  if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > MAX_NAME_LENGTH))
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  if (blocks !== undefined) {
    const blocksError = validateBlocks(blocks);
    if (blocksError) return NextResponse.json({ error: blocksError }, { status: 422 });
  }

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("coverage_profiles")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!existing)
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  if (name !== undefined) {
    const { error } = await supabase
      .from("coverage_profiles")
      .update({ name: name.trim() })
      .eq("id", id);
    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: "A profile with this name already exists" }, { status: 409 });
      console.error("[api/coverage-profiles]", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  if (blocks !== undefined) {
    const { error: deleteError } = await supabase
      .from("coverage_profile_blocks")
      .delete()
      .eq("profile_id", id);
    if (deleteError) {
      console.error("[api/coverage-profiles]", deleteError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if ((blocks as CoverageBlock[]).length > 0) {
      const { error: insertError } = await supabase
        .from("coverage_profile_blocks")
        .insert((blocks as CoverageBlock[]).map((b) => ({
          profile_id:    id,
          start_minutes: b.startMinutes,
          end_minutes:   b.endMinutes,
          headcount:     b.headcount,
        })));
      if (insertError) {
        console.error("[api/coverage-profiles]", insertError);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
    }
  }

  writeAuditLog({
    action:       "coverage_profile.update",
    actorId:      user?.id,
    resourceType: "coverage_profile",
    resourceId:   String(id),
    before: { name: existing.name },
    after: { name: name?.trim() ?? existing.name, blocks },
    metadata: { name: name?.trim() ?? existing.name },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (id == null || !Number.isInteger(id))
    return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError } = await requireManager(supabase);
  if (authError) return NextResponse.json({ error: authError }, { status: authError === "Not authenticated" ? 401 : 403 });

  const { data: existing } = await supabase
    .from("coverage_profiles")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  // Cascades to blocks, day defaults, and date overrides.
  const { error } = await supabase
    .from("coverage_profiles")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[api/coverage-profiles]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  writeAuditLog({
    action:       "coverage_profile.delete",
    actorId:      user?.id,
    resourceType: "coverage_profile",
    resourceId:   String(id),
    before: { name: existing?.name ?? null },
    metadata: { name: existing?.name ?? null },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
