/**
 * Brand-aware ZIP archive composer for the Site Builder (Sprint 11.5).
 *
 * Pure function that takes a `SafeBrandContext` and returns a Uint8Array
 * containing a fully-rebranded "kit" archive. We intentionally embed only
 * brand-safe rendered text (no MARQ secrets, no source code from the MFD
 * project itself — the user must remix the source project on Lovable to
 * get the actual app code; this kit is the *brand overlay* that sits on top).
 *
 * Why we don't bundle MFD source: pulling another project's tree at runtime
 * inside a Cloudflare Worker requires either embedding the snapshot at build
 * time (huge bundle) or making outbound HTTP calls with privileged tokens
 * (security risk + flaky). The white-label flow we ship today is:
 *
 *   1. User configures brand in `/brand/site-builder`.
 *   2. Generates this archive — overlay-only, ~30 KB.
 *   3. Remixes the MFD source project on Lovable in 1 click.
 *   4. Drops the overlay files into the remix; the README walks them through.
 *
 * This keeps the Worker fast, deterministic, and free of secret leakage.
 */
import JSZip from "jszip";
import type { SafeBrandContext } from "./brandContext";
import {
  brandReadme,
  brandMarkdown,
  themeCss,
  indexHtml,
  manifestWebmanifest,
  packageJson,
  envExample,
  assetsReadme,
  fullIndexCss,
  brandRemixGuide,
  seedJson,
  marqClientTs,
  agentsReadme,
} from "./templates";
import {
  nicheBriefMd,
  nicheSeedJson,
  lovableRemixPrompt,
  pagesInventoryMd,
  readNicheProfile,
  isWizardComplete,
} from "./nicheTemplates";

export type BuiltArchive = {
  bytes: Uint8Array;
  sha256: string;
  size: number;
};

export async function buildBrandArchive(ctx: SafeBrandContext): Promise<BuiltArchive> {
  const zip = new JSZip();

  // Top-level docs (read first by the user).
  zip.file("README.md", brandReadme(ctx));
  zip.file("REMIX_GUIDE.md", brandRemixGuide(ctx));
  zip.file("BRAND.md", brandMarkdown(ctx));
  zip.file("MARQ_AGENTS.md", agentsReadme(ctx));

  // Drop-in files for the remixed MFD project.
  zip.file("src/index.css", fullIndexCss(ctx));
  zip.file("src/lib/marq-client.ts", marqClientTs(ctx));
  zip.file("index.html", indexHtml(ctx));
  zip.file("public/manifest.webmanifest", manifestWebmanifest(ctx));
  zip.file("package.json", packageJson(ctx));
  zip.file(".env.example", envExample(ctx));

  // Brand content for one-shot Lovable-chat seeding.
  // Use niche-aware seed if the wizard was completed; otherwise legacy seed.
  const niche = readNicheProfile(ctx);
  const wizardOk = isWizardComplete(niche);
  zip.file("seed.json", wizardOk ? nicheSeedJson(ctx) : seedJson(ctx));

  // Niche-tailored docs (only when wizard completed).
  if (wizardOk) {
    zip.file("NICHE_BRIEF.md", nicheBriefMd(ctx));
    zip.file("LOVABLE_REMIX_PROMPT.md", lovableRemixPrompt(ctx));
    zip.file("PAGES_INVENTORY.md", pagesInventoryMd(ctx));
  }

  // Legacy theme overlay kept for users who only want the color tokens.
  zip.file("theme.css", themeCss(ctx));

  zip.file("assets/README.md", assetsReadme(ctx));

  // Manifest.json — machine-readable inventory for consumers / debugging.
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        template: { key: ctx.template.key, name: ctx.template.name },
        tenant: { id: ctx.tenant.id, slug: ctx.tenant.slug },
        brand: {
          name: ctx.profile.brand_name,
          locale: ctx.profile.locale,
          currency: ctx.profile.currency,
          primary: ctx.profile.primary_color,
          accent: ctx.profile.accent_color,
        },
        marq_engine: {
          api_base: "https://e-marq.lovable.app",
          tenant_id: ctx.tenant.id,
          agents_count: 86,
          sdk_path: "src/lib/marq-client.ts",
          docs: "MARQ_AGENTS.md",
        },
        files: [
          "README.md",
          "REMIX_GUIDE.md",
          "BRAND.md",
          "MARQ_AGENTS.md",
          "src/index.css",
          "src/lib/marq-client.ts",
          "index.html",
          "public/manifest.webmanifest",
          "package.json",
          ".env.example",
          "seed.json",
          "theme.css",
          "assets/README.md",
          "manifest.json",
        ],
      },
      null,
      2,
    ),
  );

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const sha256 = await sha256Hex(bytes);
  return { bytes, sha256, size: bytes.byteLength };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer to satisfy WebCrypto's BufferSource typing
  // (Uint8Array<ArrayBufferLike> from JSZip isn't directly assignable).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
