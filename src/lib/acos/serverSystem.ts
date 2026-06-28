/**
 * Smart API Server — HTTP сервер для API.
 *
 * Можливості:
 * 1. Маршрутизація
 * 2. Middleware
 * 3. Обробка помилок
 * 4. CORS
 * 5. Логування
 */

export type ServerConfig = {
  port: number;
  host: string;
};

export type RouteHandler = (request: Request) => Promise<Response>;

export type ServerRoute = {
  path: string;
  method: string;
  handler: RouteHandler;
};

export class SmartServer {
  private routes: ServerRoute[] = [];
  private middleware: Array<(req: Request, next: () => Promise<Response>) => Promise<Response>> = [];

  use(middleware: (req: Request, next: () => Promise<Response>) => Promise<Response>): void {
    this.middleware.push(middleware);
  }

  get(path: string, handler: RouteHandler): void {
    this.routes.push({ path, method: "GET", handler });
  }

  post(path: string, handler: RouteHandler): void {
    this.routes.push({ path, method: "POST", handler });
  }

  put(path: string, handler: RouteHandler): void {
    this.routes.push({ path, method: "PUT", handler });
  }

  delete(path: string, handler: RouteHandler): void {
    this.routes.push({ path, method: "DELETE", handler });
  }

  async handle(request: Request): Promise<Response> {
    // Apply middleware
    let handler: () => Promise<Response> = async () => {
      const url = new URL(request.url);

      for (const route of this.routes) {
        if (route.method === request.method && url.pathname === route.path) {
          try {
            return await route.handler(request);
          } catch (error) {
            console.error(`Error in ${route.method} ${route.path}:`, error);
            return Response.json(
              { ok: false, error: "Internal Server Error" },
              { status: 500 },
            );
          }
        }
      }

      return Response.json({ ok: false, error: "Not Found" }, { status: 404 });
    };

    // Apply middleware in reverse order
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i];
      const nextHandler = handler;
      handler = () => mw(request, nextHandler);
    }

    return handler();
  }
}
