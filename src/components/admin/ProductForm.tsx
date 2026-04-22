import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export interface ProductFormValues {
  name: string;
  sku: string;
  price_cents: number;
  currency: string;
  stock: number;
  description: string;
  image_url: string;
  is_active: boolean;
}

interface ProductFormProps {
  initialValues?: Partial<ProductFormValues>;
  onSubmit: (values: ProductFormValues) => void;
  onCancel: () => void;
  isPending: boolean;
  submitLabel?: string;
}

const defaults: ProductFormValues = {
  name: "",
  sku: "",
  price_cents: 0,
  currency: "UAH",
  stock: 0,
  description: "",
  image_url: "",
  is_active: true,
};

export function ProductForm({
  initialValues,
  onSubmit,
  onCancel,
  isPending,
  submitLabel = "Зберегти",
}: ProductFormProps) {
  const [name, setName] = useState(initialValues?.name ?? defaults.name);
  const [sku, setSku] = useState(initialValues?.sku ?? defaults.sku);
  const [priceDollars, setPriceDollars] = useState(
    ((initialValues?.price_cents ?? 0) / 100).toFixed(2),
  );
  const [currency, setCurrency] = useState(initialValues?.currency ?? defaults.currency);
  const [stock, setStock] = useState(String(initialValues?.stock ?? 0));
  const [description, setDescription] = useState(
    initialValues?.description ?? defaults.description,
  );
  const [imageUrl, setImageUrl] = useState(initialValues?.image_url ?? defaults.image_url);
  const [isActive, setIsActive] = useState(initialValues?.is_active ?? defaults.is_active);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Назва обовʼязкова");
      return;
    }
    const priceNum = Number(priceDollars);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("Ціна має бути числом не меншим за 0");
      return;
    }
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setError("Залишок має бути цілим числом не меншим за 0");
      return;
    }

    onSubmit({
      name: trimmedName,
      sku: sku.trim(),
      price_cents: Math.round(priceNum * 100),
      currency: currency.trim().toUpperCase() || "UAH",
      stock: stockNum,
      description: description.trim(),
      image_url: imageUrl.trim(),
      is_active: isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="product-name">Назва *</Label>
        <Input
          id="product-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="product-sku">Артикул (SKU)</Label>
          <Input
            id="product-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            maxLength={100}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-currency">Валюта</Label>
          <Input
            id="product-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={8}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="product-price">Ціна</Label>
          <Input
            id="product-price"
            type="number"
            step="0.01"
            min="0"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-stock">Залишок на складі</Label>
          <Input
            id="product-stock"
            type="number"
            step="1"
            min="0"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-image">Посилання на фото</Label>
        <Input
          id="product-image"
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          maxLength={1000}
          placeholder="https://…"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="product-description">Опис</Label>
        <Textarea
          id="product-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <Label htmlFor="product-active" className="cursor-pointer">
            У продажу
          </Label>
          <p className="text-xs text-muted-foreground">Видно покупцям у магазині</p>
        </div>
        <Switch id="product-active" checked={isActive} onCheckedChange={setIsActive} />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Скасувати
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {isPending ? "Зберігаю…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
