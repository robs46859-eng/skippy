import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export type AuthenticatedContext = {
  userId: string;
};

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function getServiceRoleKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY") ??
    "";
}

export function createServiceClient() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getServiceRoleKey();

  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUserFromRequest(
  req: Request,
): Promise<AuthenticatedContext> {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header.");
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) {
    throw new Error("Access token is empty.");
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user?.id) {
    throw new Error(`Unauthorized: ${error?.message ?? "invalid user token"}`);
  }

  return { userId: data.user.id };
}
