/**
 * ImageUploadField — поле URL зображення з кнопкою завантаження файла
 * у Supabase Storage (бакет `brand-assets`, шлях `<tenant_id>/<field>-<ts>.<ext>`).
 *
 * Поле URL лишається робочим fallback'ом: власник може як вставити готове
 * посилання, так і завантажити файл (image/*, до 2MB) — після завантаження
 * publicUrl підставляється у поле. Якщо бакет ще не створено (міграція не
 * застосована), показуємо зрозумілий toast і не ламаємо форму.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "brand-assets";
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "png";
}

/** Завантажує файл у `brand-assets/<tenantId>/<field>-<timestamp>.<ext>` і повертає publicUrl. */
async function uploadBrandAsset(tenantId: string, field: string, file: File): Promise<string> {
  const path = `${tenantId}/${field}-${Date.now()}.${extOf(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

type ImageUploadFieldProps = {
  id: string;
  /** Тенант, до префіксу якого піде файл. */
  tenantId: string;
  /** Префікс імені файла у сховищі: logo / hero / banner. */
  field: string;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  className?: string;
};

export function ImageUploadField({
  id,
  tenantId,
  field,
  value,
  onChange,
  placeholder,
  className,
}: ImageUploadFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Оберіть файл зображення (PNG, JPG, SVG, WebP…)");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Файл завеликий — максимум 2MB");
      return;
    }
    try {
      setUploading(true);
      const url = await uploadBrandAsset(tenantId, field, file);
      onChange(url);
      toast.success("Зображення завантажено — не забудьте натиснути «Зберегти все»");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/bucket not found/i.test(msg)) {
        toast.error("Сховище зображень ще не налаштовано — вставте URL вручну");
      } else if (/row-level security|violates|unauthorized|not allowed/i.test(msg)) {
        toast.error("Немає прав на завантаження зображень для цього бренду");
      } else {
        toast.error(`Не вдалося завантажити зображення: ${msg}`);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // дозволяє повторно обрати той самий файл
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="shrink-0"
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-1.5 h-4 w-4" />
        )}
        Завантажити
      </Button>
    </div>
  );
}
