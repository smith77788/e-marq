import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type SignUpResult = { needsEmailConfirmation: boolean };

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isSuperAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function humanizeAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Невірний email або пароль. Перевірте дані або скиньте пароль.";
  }
  if (m.includes("email not confirmed")) {
    return "Email ще не підтверджено. Перевірте поштову скриньку.";
  }
  if (m.includes("user already registered")) {
    return "Користувач з цим email вже існує. Спробуйте увійти.";
  }
  if (m.includes("password should be") || m.includes("weak password")) {
    return "Пароль занадто слабкий. Мінімум 8 символів.";
  }
  if (m.includes("rate limit")) {
    return "Забагато спроб. Спробуйте за хвилину.";
  }
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setTimeout(() => {
          void checkSuperAdmin(newSession.user.id);
        }, 0);
      } else {
        setIsSuperAdmin(false);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        void checkSuperAdmin(data.session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkSuperAdmin(userId: string) {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "super_admin")
      .maybeSingle();
    setIsSuperAdmin(!!data);
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error) throw new Error(humanizeAuthError(error.message));
  }

  async function signUp(email: string, password: string): Promise<SignUpResult> {
    const redirectUrl = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: { emailRedirectTo: redirectUrl },
    });
    if (error) throw new Error(humanizeAuthError(error.message));
    // If session exists immediately → auto-confirm is on
    return { needsEmailConfirmation: !data.session };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(humanizeAuthError(error.message));
  }

  async function updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(humanizeAuthError(error.message));
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isSuperAdmin,
        loading,
        signIn,
        signUp,
        signOut,
        requestPasswordReset,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
