import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionContext = {
  user: User;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
};

export async function withSession<T>(
  fn: (ctx: SessionContext) => Promise<T>,
): Promise<T> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect("/login");
  }
  return fn({ user: data.user, supabase });
}
