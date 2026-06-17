/**
 * Storefront layout (`/s/$slug`) — header, footer, cart sheet, theme vars,
 * shared cart context, and an Outlet for child routes.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, notFound, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  Heart,
  User,
  X,
  Package,
  Phone,
  Mail,
  Shield,
  Truck,
  RotateCcw,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { loadStorefrontShell, type StorefrontShell } from "@/lib/storefront/loaders";
import { CartProvider, useStorefrontCart, track } from "@/lib/storefront/cartContext";
import { useWishlist } from "@/hooks/useWishlist";
import { formatMoneyExact } from "@/lib/money";

export const Route = createFileRoute("/s/$slug")({
  loader: ({ params }) => loadStorefrontShell(params.slug),
  head: ({ loaderData }) => {
    const brand = loaderData?.config?.brand_name ?? loaderData?.tenant.name ?? "Store";
    const seo = loaderData?.config?.seo ?? {};
    const ui = loaderData?.config?.ui ?? {};
    const title = seo.title ?? `${brand} — Магазин`;
    const description = seo.description ?? `Замовити в магазині ${brand}.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(seo.og_image
          ? [{ property: "og:image", content: seo.og_image }]
          : (ui as Record<string, string>).logo_url
            ? [{ property: "og:image", content: (ui as Record<string, string>).logo_url }]
            : []),
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <Package className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
        <h1 className="text-3xl font-bold text-foreground">Магазин не знайдено</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Цей магазин не існує або був вимкнений.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          На головну
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }: { error: Error }) => {
    const isConfigError =
      error.message?.includes("Missing Supabase") || error.message?.includes("environment variables");
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <Package className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
          <h1 className="text-2xl font-bold text-foreground">
            {isConfigError ? "Магазин тимчасово недоступний" : "Помилка завантаження"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isConfigError
              ? "Ми вже працюємо над відновленням. Спробуйте оновити сторінку за кілька хвилин."
              : "Щось пішло не так. Спробуйте оновити сторінку або повернутися пізніше."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Оновити сторінку
          </button>
        </div>
      </div>
    );
  },
  component: StorefrontLayout,
});

function StorefrontLayout() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();

  const { data } = useQuery<StorefrontShell>({
    queryKey: ["storefront-shell", slug],
    queryFn: () => loadStorefrontShell(slug),
    initialData: initial,
    staleTime: 30_000,
  });

  if (!data) throw notFound();

  const tenant = data.tenant;
  const config = data.config;
  const brand = config?.brand_name ?? tenant.name;
  const ui = (config?.ui ?? {}) as Record<string, string>;

  const themeStyle = useMemo(() => {
    const style: Record<string, string> = {};
    // Власник зберігає кольори як primary_color/accent_color (brand.settings,
    // TenantConfigForm). Старі ключі primary/accent лишаємо як фолбек.
    const primary = ui.primary_color || ui.primary;
    const accent = ui.accent_color || ui.accent;
    if (primary) style["--primary"] = primary;
    if (accent) style["--accent"] = accent;
    if (ui.font) style["--font-sans"] = ui.font;
    return style as React.CSSProperties;
  }, [ui]);

  const cartProducts = useMemo(
    () =>
      data.products.map((p) => ({
        id: p.id,
        name: p.name,
        price_cents: p.price_cents,
        currency: p.currency,
        image_url: p.image_url,
        stock: p.stock,
      })),
    [data.products],
  );

  useEffect(() => {
    track(tenant.id, "content_viewed", { payload: { path: `/s/${slug}` } });
  }, [tenant.id, slug]);

  const announcement = ui.announcement;
  const announcementBg = ui.announcement_bg ?? "bg-primary";

  return (
    <div className="min-h-screen bg-background" style={themeStyle}>
      <CartProvider tenantId={tenant.id} brand={brand} slug={slug} initialProducts={cartProducts}>
        {announcement && <AnnouncementBar text={announcement} bgClass={announcementBg} />}
        <StorefrontHeader brand={brand} slug={slug} products={data.products} config={config} />
        <Outlet />
        <StorefrontFooter brand={brand} slug={slug} config={config} />
        <CartSheet />
      </CartProvider>
    </div>
  );
}

function AnnouncementBar({ text, bgClass }: { text: string; bgClass: string }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div
      className={`relative flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium text-primary-foreground ${bgClass}`}
    >
      <Star className="h-3 w-3 shrink-0" />
      <span>{text}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
        aria-label="Закрити"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

type SearchSuggestion = {
  id: string;
  name: string;
  image_url: string | null;
  price_cents: number;
};

function StorefrontHeader({
  brand,
  slug,
  products,
  config,
}: {
  brand: string;
  slug: string;
  products: StorefrontShell["products"];
  config: StorefrontShell["config"];
}) {
  const { cartCount, setCartOpen, tenantId } = useStorefrontCart();
  const wishlist = useWishlist(tenantId);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const ui = (config?.ui ?? {}) as Record<string, string>;
  const logoUrl = ui.logo_url;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const suggestions = useMemo<SearchSuggestion[]>(() => {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const out: SearchSuggestion[] = [];
    for (const p of products) {
      const haystack = [p.name, p.description ?? "", ...(p.tags ?? [])].join(" ").toLowerCase();
      if (haystack.includes(query)) {
        out.push({ id: p.id, name: p.name, image_url: p.image_url, price_cents: p.price_cents });
        if (out.length >= 6) break;
      }
    }
    return out;
  }, [q, products]);

  const submit = () => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setOpen(false);
    navigate({ to: "/s/$slug/search", params: { slug }, search: { q: trimmed } });
  };

  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        {/* Brand logo/name */}
        <Link
          to="/s/$slug"
          params={{ slug }}
          className="flex shrink-0 items-center gap-2"
          aria-label={brand}
        >
          {logoUrl ? (
            <img src={logoUrl} alt={brand} className="h-8 w-auto object-contain" />
          ) : (
            <span className="text-lg font-bold tracking-tight text-foreground">{brand}</span>
          )}
        </Link>

        {/* Search bar */}
        <div
          ref={wrapperRef}
          className="relative ml-auto hidden flex-1 items-center sm:flex sm:max-w-sm"
        >
          <form
            className="flex w-full items-center"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Пошук товарів…"
                className="h-10 rounded-full pl-9 pr-4 text-sm"
                aria-label="Пошук товарів"
                aria-autocomplete="list"
                aria-expanded={open && suggestions.length > 0}
              />
            </div>
          </form>
          {open && suggestions.length > 0 && (
            <div
              role="listbox"
              className="absolute left-0 right-0 top-12 z-40 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl"
            >
              {suggestions.map((s) => (
                <button
                  type="button"
                  role="option"
                  key={s.id}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    navigate({
                      to: "/s/$slug/products/$productId",
                      params: { slug, productId: s.id },
                    });
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent"
                >
                  {s.image_url ? (
                    <img
                      src={s.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <span className="line-clamp-1 flex-1 font-medium">{s.name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-primary">
                    {formatMoneyExact(s.price_cents)}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={submit}
                className="block w-full border-t border-border px-4 py-2.5 text-left text-xs font-semibold text-primary hover:bg-accent"
              >
                Показати всі результати →
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1.5 sm:ml-3">
          {/* Wishlist */}
          <Link
            to="/s/$slug/wishlist"
            params={{ slug }}
            aria-label={`Обране (${wishlist.count})`}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Heart
              className={
                wishlist.count > 0 ? "h-4 w-4 fill-destructive text-destructive" : "h-4 w-4"
              }
            />
            {wishlist.count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
                {wishlist.count > 9 ? "9+" : wishlist.count}
              </span>
            )}
          </Link>

          {/* Account */}
          <Link
            to="/s/$slug/account"
            params={{ slug }}
            aria-label="Мої замовлення"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <User className="h-4 w-4" />
          </Link>

          {/* Cart */}
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label={`Кошик (${cartCount})`}
            className="relative inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <ShoppingCart className="h-4 w-4" />
            {cartCount > 0 && <span className="tabular-nums">{cartCount}</span>}
          </button>

          {/* Mobile search toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-input bg-background text-muted-foreground sm:hidden"
            aria-label="Пошук"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile search bar */}
      {mobileMenuOpen && (
        <div className="border-t px-4 py-3 sm:hidden">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMobileMenuOpen(false);
              submit();
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Пошук товарів…"
                className="h-10 pl-9"
                autoFocus
              />
            </div>
            <Button type="submit" size="sm">
              Знайти
            </Button>
          </form>
        </div>
      )}
    </header>
  );
}

function StorefrontFooter({
  brand,
  slug,
  config,
}: {
  brand: string;
  slug: string;
  config: StorefrontShell["config"];
}) {
  const ui = (config?.ui ?? {}) as Record<string, string>;
  const seo = config?.seo ?? {};
  const features = config?.features ?? {};
  const shipping = (features as Record<string, unknown>).shipping as
    | Record<string, unknown>
    | undefined;
  const freeFrom = shipping?.free_shipping_from_cents as number | undefined;

  let socialLinks: Record<string, string> | null = null;
  try {
    if (ui.social_links) {
      const parsed: unknown = JSON.parse(ui.social_links as string);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        socialLinks = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" && /^https?:\/\//i.test(v as string))
            .map(([k, v]) => [k, v as string]),
        );
        if (Object.keys(socialLinks).length === 0) socialLinks = null;
      }
    }
  } catch {
    // malformed JSON — ignore
  }
  const rawEmail = ui.contact_email?.trim();
  const rawPhone = ui.contact_phone?.trim();
  const contactEmail = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
  const contactPhone = rawPhone && /^[+\d\s()[\]-]{6,32}$/.test(rawPhone) ? rawPhone : null;
  const tagline = seo.description ?? null;

  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/20">
      {/* Trust bar */}
      <div className="border-b border-border/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-6 sm:grid-cols-4">
          <TrustBadge
            icon={<Truck className="h-5 w-5 text-primary" />}
            title="Нова Пошта"
            desc={freeFrom ? `Безкоштовно від ${formatMoneyExact(freeFrom)}` : "Швидка доставка"}
          />
          <TrustBadge
            icon={<Shield className="h-5 w-5 text-primary" />}
            title="Захищена оплата"
            desc="Картка, LiqPay, WayForPay"
          />
          <TrustBadge
            icon={<RotateCcw className="h-5 w-5 text-primary" />}
            title="Повернення 14 днів"
            desc="За законом України"
          />
          <TrustBadge
            icon={<Star className="h-5 w-5 text-primary" />}
            title="Гарантія якості"
            desc="Офіційна продукція"
          />
        </div>
      </div>

      {/* Main footer */}
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {/* Brand column */}
          <div className="space-y-4">
            <h3 className="text-base font-bold text-foreground">{brand}</h3>
            {tagline && <p className="text-sm leading-relaxed text-muted-foreground">{tagline}</p>}
            {/* Contact info */}
            {(contactEmail || contactPhone) && (
              <div className="space-y-1.5">
                {contactPhone && (
                  <a
                    href={`tel:${contactPhone}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {contactPhone}
                  </a>
                )}
                {contactEmail && (
                  <a
                    href={`mailto:${contactEmail}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {contactEmail}
                  </a>
                )}
              </div>
            )}
            {/* Social links */}
            {socialLinks && Object.keys(socialLinks).length > 0 && (
              <div className="flex gap-3">
                {Object.entries(socialLinks).map(([platform, url]) => (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs capitalize text-muted-foreground underline hover:text-foreground"
                  >
                    {platform}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground">
              Магазин
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link
                  to="/s/$slug"
                  params={{ slug }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Всі товари
                </Link>
              </li>
              <li>
                <Link
                  to="/s/$slug/wishlist"
                  params={{ slug }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Обране
                </Link>
              </li>
              <li>
                <Link
                  to="/s/$slug/account"
                  params={{ slug }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Мої замовлення
                </Link>
              </li>
              <li>
                <Link
                  to="/s/$slug/search"
                  params={{ slug }}
                  search={{ q: "" }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Пошук
                </Link>
              </li>
              <li>
                <Link
                  to="/s/$slug/about"
                  params={{ slug }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Про магазин
                </Link>
              </li>
              <li>
                <Link
                  to="/s/$slug/faq"
                  params={{ slug }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Часті питання
                </Link>
              </li>
            </ul>
          </div>

          {/* Info */}
          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground">
              Інформація
            </h4>
            <ul className="space-y-2.5">
              <li className="text-sm text-muted-foreground">Доставка Новою Поштою</li>
              <li className="text-sm text-muted-foreground">Оплата карткою онлайн</li>
              <li className="text-sm text-muted-foreground">Повернення протягом 14 днів</li>
              {contactEmail && (
                <li>
                  <a
                    href={`mailto:${contactEmail}`}
                    className="text-sm text-primary hover:underline"
                  >
                    Написати нам
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
          <span>
            © {year} {brand}. Усі права захищені.
          </span>
          <span className="flex items-center gap-1">
            Магазин на базі{" "}
            <a
              href="https://marq.app"
              className="font-semibold text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              MARQ
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

function TrustBadge({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function CartSheet() {
  const {
    cartLines,
    totalCents,
    currency,
    cartOpen,
    setCartOpen,
    updateQty,
    removeLine,
    slug,
    tenantId,
  } = useStorefrontCart();
  const navigate = useNavigate();

  const isEmpty = cartLines.length === 0;

  return (
    <Sheet open={cartOpen} onOpenChange={setCartOpen}>
      <SheetTrigger className="hidden" />
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Ваш кошик
            {!isEmpty && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                {cartLines.length}
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {isEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <ShoppingCart className="h-10 w-10 text-muted-foreground/40" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Кошик порожній</p>
                <p className="mt-1 text-sm text-muted-foreground">Додайте щось смачне 😊</p>
              </div>
              <Button variant="outline" onClick={() => setCartOpen(false)}>
                Продовжити покупки
              </Button>
            </div>
          ) : (
            <ul className="space-y-3 px-1">
              {cartLines.map(({ product, quantity }) => (
                <li key={product.id} className="flex gap-3 rounded-xl border p-3 shadow-sm">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.name}
                      loading="lazy"
                      decoding="async"
                      width={72}
                      height={72}
                      className="h-18 w-18 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Package className="h-7 w-7 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-medium leading-snug">
                        {product.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(product.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Видалити"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="text-xs font-semibold text-primary tabular-nums">
                      {formatMoneyExact(product.price_cents)}
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 rounded-full"
                        onClick={() => updateQty(product.id, -1)}
                        aria-label="Зменшити"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">
                        {quantity}
                      </span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7 rounded-full"
                        onClick={() => updateQty(product.id, 1)}
                        aria-label="Збільшити"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        = {formatMoneyExact(product.price_cents * quantity)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!isEmpty && (
          <SheetFooter className="border-t pt-4">
            <div className="w-full space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Разом</span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoneyExact(totalCents)}
                </span>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={() => {
                  track(tenantId, "checkout_started", {
                    payload: { total_cents: totalCents, items: cartLines.length, currency },
                  });
                  setCartOpen(false);
                  navigate({ to: "/s/$slug/checkout", params: { slug } });
                }}
              >
                Оформити замовлення →
              </Button>
              <p className="text-center text-[10px] text-muted-foreground">
                🔒 Безпечна оплата · Нова Пошта · Повернення 14 днів
              </p>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
