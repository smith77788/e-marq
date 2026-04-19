import { useState, type FormEvent } from "react";
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
  currency: "USD",
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
  submitLabel = "Save",
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
      setError("Name is required");
      return;
    }
    const priceNum = Number(priceDollars);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("Price must be a non-negative number");
      return;
    }
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setError("Stock must be a non-negative integer");
      return;
    }

    onSubmit({
      name: trimmedName,
      sku: sku.trim(),
      price_cents: Math.round(priceNum * 100),
      currency: currency.trim().toUpperCase() || "USD",
      stock: stockNum,
      description: description.trim(),
      image_url: imageUrl.trim(),
      is_active: isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="product-name">Name *</Label>
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
          <Label htmlFor="product-sku">SKU</Label>
          <Input
            id="product-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            maxLength={100}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-currency">Currency</Label>
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
          <Label htmlFor="product-price">Price</Label>
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
          <Label htmlFor="product-stock">Stock</Label>
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
        <Label htmlFor="product-image">Image URL</Label>
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
        <Label htmlFor="product-description">Description</Label>
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
            Active
          </Label>
          <p className="text-xs text-muted-foreground">Visible in storefront</p>
        </div>
        <Switch id="product-active" checked={isActive} onCheckedChange={setIsActive} />
      </div>

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
