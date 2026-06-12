/**
 * ImageUploadField — поле зображення для налаштувань бренду.
 *
 * Комбінує URL-інпут (вставити готове посилання) з кнопкою завантаження
 * файлу в публічний bucket `brand-assets` Supabase Storage. Після успішного
 * завантаження у поле підставляється публічний URL обʼєкта, тож решта
 * коду (збереження у tenant_configs, вітрина) працює без змін.
 *
 * Шлях обʼєкта: `<tenantId>/<slug>-<uuid>.<ext>` — перший сегмент є tenant
 * UUID, на ньому тримаються RLS-політики bucket'а (запис лише учасникам
 * tenant'а, читання публічне).
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "brand-assets";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
];

/** Повертає текст помилки або null, якщо файл придатний до завантаження. */
export function validateImageFile(file: Pick<File, "type" | "size">): string | null {
  if (!ACCEPTED.includes(file.type)) {
    return "Непідтримуваний формат. Дозволено: JPG, PNG, WebP, AVIF, GIF, SVG.";
  }
  if (file.size > MAX_BYTES) {
    return "Файл завеликий — максимум 5MB.";
  }
  return null;
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "bin";
}

type Props = {
  tenantId: string;
  /** Префікс імені файлу в bucket'і: "logo" | "hero" | "og" тощо. */
  slug: string;
  id: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  /** Підказка під полем (формат, рекомендований розмір…). */
  hint?: string;
  /** Класи для превʼю-мініатюри; за замовчуванням — компактна картка. */
  previewClassName?: string;
};

export function ImageUploadField({
  tenantId,
  slug,
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  previewClassName,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(`${file.name}: ${invalid}`);
      return;
    }
    setUploading(true);
    try {
      const path = `${tenantId}/${slug}-${crypto.randomUUID()}.${extOf(file.name)}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success("Зображення завантажено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося завантажити зображення");
    } finally {
      setUploading(false);
      // Дозволяє повторно обрати той самий файл.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "https://…/image.png"}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Завантаження…
            </>
          ) : (
            <>
              <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
              Завантажити
            </>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => void handleFile(e.target.files)}
        />
      </div>
      {value && (
        // key=value перезапускає <img>, щоб прибрати display:none після
        // onError, коли URL змінився на валідний.
        <img
          key={value}
          src={value}
          alt={`${label} — превʼю`}
          loading="lazy"
          decoding="async"
          className={
            previewClassName ?? "max-h-40 rounded-md border border-border bg-card object-cover"
          }
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {hint ? `${hint} ` : ""}Вставте URL або завантажте файл (до 5MB).
      </p>
    </div>
  );
}
