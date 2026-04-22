import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { DetailControllerProvider, DetailDrawer } from "@/components/detail";

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
      { title: "MARQ — Merchant Autonomous Revenue Quorum" },
      { name: "description", content: "MARQ — автономна команда AI-агентів, які зупиняють витік грошей у вашому магазині 24/7." },
      { name: "author", content: "MARQ" },
      { property: "og:title", content: "MARQ — Merchant Autonomous Revenue Quorum" },
      { property: "og:description", content: "Автономна команда AI-агентів, які зупиняють витік грошей у вашому магазині 24/7." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "MARQ — Merchant Autonomous Revenue Quorum" },
      { name: "twitter:description", content: "Автономна команда AI-агентів, які зупиняють витік грошей у вашому магазині 24/7." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/d6531aeb-2016-4df0-a5b4-dd41ec4c07ca" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/d6531aeb-2016-4df0-a5b4-dd41ec4c07ca" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DetailControllerProvider>
          <Outlet />
          <DetailDrawer />
          <Toaster richColors position="top-right" theme="system" />
        </DetailControllerProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
