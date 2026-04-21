/**
 * Двоетапний селектор Nova Poshta: місто → відділення.
 * Debounced пошук, без зовнішніх combobox-ів — нативний пошук + список.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Package, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  searchCities,
  searchWarehouses,
  type NPCity,
  type NPSelection,
  type NPWarehouse,
} from "@/lib/shipping/novaPoshta";

type Props = {
  value: NPSelection | null;
  onChange: (selection: NPSelection | null) => void;
  disabled?: boolean;
};

export function ShippingSelector({ value, onChange, disabled }: Props) {
  // City state
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<NPCity[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);

  // Warehouse state
  const [whQuery, setWhQuery] = useState("");
  const [warehouses, setWarehouses] = useState<NPWarehouse[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [whError, setWhError] = useState<string | null>(null);

  // Selected city (without warehouse yet)
  const [pendingCity, setPendingCity] = useState<{ ref: string; name: string } | null>(
    value ? { ref: value.cityRef, name: value.cityName } : null,
  );

  const cityTimer = useRef<number | null>(null);
  const whTimer = useRef<number | null>(null);

  // Debounced city search
  useEffect(() => {
    if (pendingCity) return; // already chose
    if (cityTimer.current) window.clearTimeout(cityTimer.current);
    if (cityQuery.trim().length < 2) {
      setCities([]);
      return;
    }
    setCityLoading(true);
    setCityError(null);
    cityTimer.current = window.setTimeout(async () => {
      try {
        const result = await searchCities(cityQuery);
        setCities(result);
      } catch (e) {
        setCityError(e instanceof Error ? e.message : "Помилка");
        setCities([]);
      } finally {
        setCityLoading(false);
      }
    }, 350);
    return () => {
      if (cityTimer.current) window.clearTimeout(cityTimer.current);
    };
  }, [cityQuery, pendingCity]);

  // Load warehouses when city picked
  useEffect(() => {
    if (!pendingCity) {
      setWarehouses([]);
      return;
    }
    if (whTimer.current) window.clearTimeout(whTimer.current);
    setWhLoading(true);
    setWhError(null);
    whTimer.current = window.setTimeout(async () => {
      try {
        const result = await searchWarehouses(pendingCity.ref, whQuery);
        setWarehouses(result);
      } catch (e) {
        setWhError(e instanceof Error ? e.message : "Помилка");
        setWarehouses([]);
      } finally {
        setWhLoading(false);
      }
    }, 300);
    return () => {
      if (whTimer.current) window.clearTimeout(whTimer.current);
    };
  }, [pendingCity, whQuery]);

  function pickCity(c: NPCity) {
    setPendingCity({ ref: c.ref, name: c.present || c.name });
    setCityQuery("");
    setCities([]);
    setWhQuery("");
    onChange(null); // reset full selection until WH chosen
  }

  function pickWarehouse(w: NPWarehouse) {
    if (!pendingCity) return;
    onChange({
      cityRef: pendingCity.ref,
      cityName: pendingCity.name,
      warehouseRef: w.ref,
      warehouseNumber: w.number,
      warehouseDescription: w.description || w.shortAddress,
    });
  }

  function reset() {
    setPendingCity(null);
    setCityQuery("");
    setWhQuery("");
    setCities([]);
    setWarehouses([]);
    onChange(null);
  }

  // If complete selection — show summary
  if (value) {
    return (
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              {value.cityName}
            </div>
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Package className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                №{value.warehouseNumber} — {value.warehouseDescription}
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={reset}
            disabled={disabled}
            className="h-7 text-xs"
          >
            Змінити
          </Button>
        </div>
      </div>
    );
  }

  // Step 2: warehouse picker
  if (pendingCity) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span className="font-medium text-foreground">{pendingCity.name}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPendingCity(null)}
            disabled={disabled}
            className="h-6 text-[11px]"
          >
            <X className="mr-1 h-3 w-3" /> Інше місто
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={whQuery}
            onChange={(e) => setWhQuery(e.target.value)}
            placeholder="Пошук відділення (№ або адреса)"
            className="h-9 pl-8 text-sm"
            disabled={disabled}
          />
        </div>
        {whError && <p className="text-xs text-destructive">{whError}</p>}
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {whLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : warehouses.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">Немає відділень</p>
          ) : (
            <ul className="divide-y">
              {warehouses.map((w) => (
                <li key={w.ref}>
                  <button
                    type="button"
                    onClick={() => pickWarehouse(w)}
                    disabled={disabled}
                    className="flex w-full items-start gap-2 p-2.5 text-left text-xs hover:bg-accent/50 disabled:opacity-50"
                  >
                    <Package className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">№{w.number}</p>
                      <p className="line-clamp-2 text-muted-foreground">
                        {w.description || w.shortAddress}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Step 1: city picker
  return (
    <div className="space-y-2">
      <Label htmlFor="np-city" className="text-xs">
        Місто
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          id="np-city"
          value={cityQuery}
          onChange={(e) => setCityQuery(e.target.value)}
          placeholder="Почніть вводити місто..."
          className="h-9 pl-8 text-sm"
          disabled={disabled}
        />
      </div>
      {cityError && <p className="text-xs text-destructive">{cityError}</p>}
      {(cities.length > 0 || cityLoading) && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          {cityLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="divide-y">
              {cities.map((c) => (
                <li key={c.ref}>
                  <button
                    type="button"
                    onClick={() => pickCity(c)}
                    disabled={disabled}
                    className="flex w-full items-start gap-2 p-2.5 text-left text-xs hover:bg-accent/50 disabled:opacity-50"
                  >
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{c.present || c.name}</p>
                      {c.area && <p className="text-muted-foreground">{c.area}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
