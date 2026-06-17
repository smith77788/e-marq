// Lovable auth proxy — OAuth via Lovable's built-in Supabase integration.
// This works WITHOUT Supabase env vars if the project is linked in Lovable dashboard.

import { createLovableAuth } from "@lovable.dev/cloud-auth-js";
import { isSupabaseConfigured } from "../supabase/client";

const lovableAuth = createLovableAuth();

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (provider: "google" | "apple" | "microsoft", opts?: SignInOptions) => {
      const result = await lovableAuth.signInWithOAuth(provider, {
        redirect_uri: opts?.redirect_uri,
        extraParams: {
          ...opts?.extraParams,
        },
      });

      if (result.redirected) {
        return result;
      }

      if (result.error) {
        return result;
      }

      // Only try to set session if Supabase is configured
      // Lovable proxy handles the OAuth flow independently
      if (isSupabaseConfigured()) {
        try {
          const { supabase } = await import("../supabase/client");
          await supabase.auth.setSession(result.tokens);
        } catch (e) {
          // Session set failed but OAuth succeeded — continue
          console.warn("[lovable] setSession failed:", e);
        }
      }
      return result;
    },
  },
};
