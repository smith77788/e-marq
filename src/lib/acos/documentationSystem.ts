/**
 * Smart API Documentation — автоматична документація API.
 *
 * Формати:
 * 1. OpenAPI 3.0 — стандартна документація
 * 2. Markdown — читабельна документація
 * 3. Postman Collection — для тестування
 */

export type ApiEndpoint = {
  method: string;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required: boolean;
    type: string;
    description?: string;
  }>;
  requestBody?: {
    contentType: string;
    schema: Record<string, unknown>;
  };
  responses: Record<string, { description: string; schema?: Record<string, unknown> }>;
};

/**
 * Згенерувати OpenAPI spec.
 */
export function generateOpenApiSpec(
  endpoints: ApiEndpoint[],
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const endpoint of endpoints) {
    if (!paths[endpoint.path]) {
      paths[endpoint.path] = {};
    }

    (paths[endpoint.path] as Record<string, unknown>)[endpoint.method.toLowerCase()] = {
      summary: endpoint.summary,
      description: endpoint.description,
      tags: endpoint.tags,
      parameters: endpoint.parameters,
      requestBody: endpoint.requestBody,
      responses: endpoint.responses,
    };
  }

  return {
    openapi: "3.0.0",
    info: {
      title: "MARQ API",
      description: "Revenue OS for D2C brands — 70+ AI agents",
      version: "2.0.0",
    },
    servers: [
      { url: "https://e-marq.lovable.app", description: "Production" },
    ],
    paths,
  };
}

/**
 * Згенерувати Markdown документацію.
 */
export function generateMarkdownDocs(
  endpoints: ApiEndpoint[],
): string {
  let md = "# MARQ API Documentation\n\n";

  const byTag: Record<string, ApiEndpoint[]> = {};
  for (const ep of endpoints) {
    for (const tag of ep.tags) {
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(ep);
    }
  }

  for (const [tag, eps] of Object.entries(byTag)) {
    md += `## ${tag}\n\n`;
    for (const ep of eps) {
      md += `### ${ep.method} ${ep.path}\n\n`;
      md += `${ep.summary}\n\n`;
      if (ep.description) {
        md += `${ep.description}\n\n`;
      }
    }
  }

  return md;
}
