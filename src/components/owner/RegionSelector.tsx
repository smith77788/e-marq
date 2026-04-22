/**
 * RegionSelector — controlled component for picking a country and a list of
 * cities that pricing/promo agents should target.
 *
 * - Country: select from COMMON_COUNTRIES list (UA default).
 * - "Whole country" switch: when ON, cities are ignored.
 * - Cities (only when whole_country is OFF):
 *     • For UA: live autocomplete via Nova Poshta (/api/public/shipping/np).
 *     • For other countries: free-text input → press Enter to add a city tag.
 * - Selected cities show as removable badges.
 *
 * The component does NOT save by itself — pass value/onChange and persist
 * in the parent form (brand settings, agent permissions card, etc.).
 */
import { useEffect, useMemo, useState } from "react";
import { Globe2, Loader2, MapPin, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { searchCities, type NPCity } from "@/lib/shipping/novaPoshta";
import {
  COMMON_COUNTRIES,
  DEFAULT_GEO_TARGETS,
  countryLabel,
  type GeoCity,
  type GeoTargets,
} from "@/lib/acos/geoTargets";

type Props = {
  value: GeoTargets | null;
  onChange: (next: GeoTargets) => void;
  /** Compact rendering for small spaces (e.g. inside agent permissions card). */
  compact?: boolean;
  /** Show inheritance hint when override is empty. */
  inheritHint?: string;
  /** Allow user to clear the override (used in agent override mode). */
  onClear?: () => void;
};

export function RegionSelector({
  value,
  onChange,
  compact = false,
  inheritHint,
  onClear,
}: Props) {
  const current = value ?? DEFAULT_GEO_TARGETS;
  const [query, setQuery] = useState("");
  const [npResults, setNpResults] = useState<NPCity[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualCity, setManualCity] = useState("");

  const isUA = current.country === "UA";
  const showCities = !current.whole_country;

  // Debounced NP search (UA only)
  useEffect(() => {
    if (!isUA || !showCities) {
      setNpResults([]);
      return;
    }
    const q = query.trim();
    if (q.length < 2) {
      setNpResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const cities = await searchCities(q);
        if (!cancelled) setNpResults(cities);
      } catch {
        if (!cancelled) setNpResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, isUA, showCities]);

  const selectedKeys = useMemo(
    () => new Set(current.cities.map((c) => c.name.trim().toLowerCase())),
    [current.cities],
  );

  function setCountry(code: string) {
    onChange({
      ...current,
      country: code,
      cities: [],          // reset cities when country switches
      whole_country: true, // safe default
    });
    setQuery("");
    setNpResults([]);
    setManualCity("");
  }

  function setWholeCountry(v: boolean) {
    onChange({ ...current, whole_country: v });
  }

  function addCity(c: GeoCity) {
    const key = c.name.trim().toLowerCase();
    if (!key || selectedKeys.has(key)) return;
    onChange({ ...current, cities: [...current.cities, c], whole_country: false });
    setQuery("");
    setManualCity("");
  }

  function removeCity(name: string) {
    onChange({
      ...current,
      cities: current.cities.filter((c) => c.name !== name),
    });
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {inheritHint && !value && (
        <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {inheritHint}
        </div>
      )}

      {/* Country */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-sm">
          <Globe2 className="h-3.5 w-3.5 text-primary" /> Країна
        </Label>
        <Select value={current.country} onValueChange={setCountry}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMON_COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="font-mono text-xs text-muted-foreground">{c.code}</span>{" "}
                {c.nameUk}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Whole country switch */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Вся країна</div>
          <div className="text-xs text-muted-foreground">
            Якщо увімкнено — агент аналізує дані по всій {countryLabel(current.country)}.
          </div>
        </div>
        <Switch checked={current.whole_country} onCheckedChange={setWholeCountry} />
      </div>

      {/* Cities */}
      {showCities && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 text-sm">
            <MapPin className="h-3.5 w-3.5 text-accent" /> Міста ({current.cities.length})
          </Label>

          {/* Selected city badges */}
          {current.cities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {current.cities.map((c) => (
                <Badge
                  key={c.name}
                  variant="secondary"
                  className="gap-1 pr-1 font-normal"
                >
                  {c.name}
                  <button
                    type="button"
                    onClick={() => removeCity(c.name)}
                    aria-label={`Видалити ${c.name}`}
                    className="ml-0.5 rounded p-0.5 hover:bg-destructive/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Picker */}
          {isUA ? (
            <div className="space-y-1.5">
              <div className="relative">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Почніть вводити назву міста (Nova Poshta)…"
                />
                {searching && (
                  <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
              {npResults.length > 0 && (
                <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-popover p-1 shadow-sm">
                  {npResults.map((c) => {
                    const taken = selectedKeys.has(c.name.trim().toLowerCase());
                    return (
                      <button
                        key={`${c.ref}-${c.name}`}
                        type="button"
                        disabled={taken}
                        onClick={() => addCity({ ref: c.ref, name: c.name })}
                        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>
                          <span className="font-medium">{c.name}</span>
                          {c.area && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {c.area}
                            </span>
                          )}
                        </span>
                        {!taken && <Plus className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={manualCity}
                onChange={(e) => setManualCity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualCity.trim()) {
                    e.preventDefault();
                    addCity({ name: manualCity.trim() });
                  }
                }}
                placeholder="Введіть назву міста та натисніть Enter"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => manualCity.trim() && addCity({ name: manualCity.trim() })}
                disabled={!manualCity.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {onClear && value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
        >
          Скинути override (наслідувати з бренду)
        </Button>
      )}
    </div>
  );
}
