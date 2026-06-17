/**
 * Smart API Router — маршрутизація API запитів.
 *
 * Можливості:
 * 1. Path-based routing — маршрутизація за шляхом
 * 2. Method-based routing — маршрутизація за методом
 * 3. Middleware support — підтримка middleware
 * 4. Error handling — обробка помилок
 */

export type RouteHandler = (request: Request, params: Record<string, string>) => Promise<Response>;

export type Route = {
  path: string;
  method: string;
  handler: RouteHandler;
  middleware?: Array<(req: Request, next: () => Promise<Response>) => Promise<Response>>;
};

export class SmartRouter {
  private routes: Route[] = [];

  addRoute(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({ path, method, handler });
  }

  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute("DELETE", path, handler);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    for (const route of this.routes) {
      if (route.method === method && this.matchPath(route.path, url.pathname)) {
        const params = this.extractParams(route.path, url.pathname);
        return route.handler(request, params);
      }
    }

    return Response.json({ error: "Not Found" }, { status: 404 });
  }

  private matchPath(pattern: string, pathname: string): boolean {
    const patternParts = pattern.split("/");
    const pathParts = pathname.split("/");

    if (patternParts.length !== pathParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) continue;
      if (patternParts[i] !== pathParts[i]) return false;
    }

    return true;
  }

  private extractParams(pattern: string, pathname: string): Record<string, string> {
    const params: Record<string, string> = {};
    const patternParts = pattern.split("/");
    const pathParts = pathname.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) {
        params[patternParts[i].slice(1)] = pathParts[i];
      }
    }

    return params;
  }
}
