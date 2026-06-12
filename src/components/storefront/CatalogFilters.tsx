/**
 * CatalogFilters — shared storefront filter control (popover).
 * Used on the index, collection and search pages. Stateless: the current
 * filter values come from URL search params, changes are reported via
 * `onChange` and the route writes them back with `navigate({ search })`.
 */
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  countActiveFilters,
  EMPTY_CATALOG_FILTERS,
  type CatalogFilters as CatalogFilterValues,
} from "@/lib/storefront/catalogFilters";

const ALL_COLLECTIONS = "__all__";

export type CollectionOption = { handle: string; name: string };

function parsePrice(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export function CatalogFilters({
  value,
  onChange,
  collections,
}: {
  value: CatalogFilterValues;
  onChange: (next: CatalogFilterValues) => void;
  /** When provided, shows the collection (category) selector. */
  collections?: CollectionOption[];
}) {
  const activeCount = countActiveFilters(value);
  const showCollections = !!collections && collections.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Фільтри
          {activeCount > 0 && (
            <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px]">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        {/* Price range */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ціна, ₴
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="від"
              aria-label="Мінімальна ціна, гривень"
              className="h-9"
              value={value.price_min ?? ""}
              onChange={(e) => onChange({ ...value, price_min: parsePrice(e.target.value) })}
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="до"
              aria-label="Максимальна ціна, гривень"
              className="h-9"
              value={value.price_max ?? ""}
              onChange={(e) => onChange({ ...value, price_max: parsePrice(e.target.value) })}
            />
          </div>
        </div>

        {/* In stock */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="catalog-filter-in-stock"
            checked={!!value.in_stock}
            onCheckedChange={(checked) =>
              onChange({ ...value, in_stock: checked === true ? true : undefined })
            }
          />
          <Label htmlFor="catalog-filter-in-stock" className="cursor-pointer text-sm font-normal">
            Тільки в наявності
          </Label>
        </div>

        {/* Collection / category */}
        {showCollections && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Категорія
            </Label>
            <Select
              value={value.collection ?? ALL_COLLECTIONS}
              onValueChange={(v) =>
                onChange({ ...value, collection: v === ALL_COLLECTIONS ? undefined : v })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Усі категорії" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COLLECTIONS}>Усі категорії</SelectItem>
                {collections!.map((c) => (
                  <SelectItem key={c.handle} value={c.handle}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Separator />
        <Button
          variant="ghost"
          size="sm"
          className="w-full gap-2 text-muted-foreground"
          disabled={activeCount === 0}
          onClick={() => onChange({ ...EMPTY_CATALOG_FILTERS })}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Скинути фільтри
        </Button>
      </PopoverContent>
    </Popover>
  );
}
