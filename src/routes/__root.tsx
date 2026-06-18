import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { DetailControllerProvider, DetailDrawer } from "@/components/detail";
import { CookieConsent } from "@/components/CookieConsent";
import { getLang } from "@/lib/i18n";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MARQ — Revenue OS for D2C brands" },
      {
        name: "description",
        content:
          "MARQ — автономна команда AI-агентів, які зупиняють витік грошей у вашому магазині 24/7.",
      },
      { name: "author", content: "MARQ" },
      { property: "og:title", content: "MARQ — Revenue OS for D2C brands" },
      {
        property: "og:description",
        content: "Автономна команда AI-агентів, які зупиняють витік грошей у вашому магазині 24/7.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "MARQ — Revenue OS for D2C brands" },
      {
        name: "twitter:description",
        content: "Автономна команда AI-агентів, які зупиняють витік грошей у вашому магазині 24/7.",
      },
      // NOTE: og:image / twitter:image intentionally NOT set at root level —
      // TanStack Router merges head() from all matched routes, and a root
      // og:image always wins over leaf-route images. Set og:image only at
      // the leaf-route level (via buildSeo({ ogImage })).
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { name: "theme-color", content: "#6366f1" },
      { rel: "apple-touch-icon", href: "/favicon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );

  // Update HTML lang attribute when language changes
  useEffect(() => {
    const updateLang = () => {
      document.documentElement.lang = getLang();
    };
    updateLang();
    // Listen for language changes
    const interval = setInterval(updateLang, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DetailControllerProvider>
          <Outlet />
          <DetailDrawer />
          <Toaster richColors position="top-right" theme="system" />
          <CookieConsent />
        </DetailControllerProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
// trigger deploy
// v1.0 ready
// deploy trigger 1781738091
// Supabase connected 1781739237
// supabase reconnected 1781739510
