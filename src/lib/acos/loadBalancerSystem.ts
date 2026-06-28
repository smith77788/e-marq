/**
 * Smart Load Balancer — балансування навантаження між серверами.
 *
 * Стратегії:
 * 1. Round Robin — почерговий
 * 2. Least Connections — найменше з'єднань
 * 3. Weighted — зважений
 * 4. IP Hash — за IP адресою
 */

export type Server = {
  id: string;
  url: string;
  weight: number;
  connections: number;
  healthy: boolean;
};

export class LoadBalancer {
  private servers: Server[] = [];
  private currentIndex = 0;

  addServer(server: Server): void {
    this.servers.push(server);
  }

  removeServer(id: string): void {
    this.servers = this.servers.filter((s) => s.id !== id);
  }

  /**
   * Round Robin вибір.
   */
  nextRoundRobin(): Server | null {
    const healthy = this.servers.filter((s) => s.healthy);
    if (healthy.length === 0) return null;

    const server = healthy[this.currentIndex % healthy.length];
    this.currentIndex = (this.currentIndex + 1) % healthy.length;
    return server;
  }

  /**
   * Least Connections вибір.
   */
  nextLeastConnections(): Server | null {
    const healthy = this.servers.filter((s) => s.healthy);
    if (healthy.length === 0) return null;

    return healthy.reduce((min, s) =>
      s.connections < min.connections ? s : min,
    healthy[0]);
  }

  /**
   * Weighted вибір.
   */
  nextWeighted(): Server | null {
    const healthy = this.servers.filter((s) => s.healthy);
    if (healthy.length === 0) return null;

    const totalWeight = healthy.reduce((s, server) => s + server.weight, 0);
    let random = Math.random() * totalWeight;

    for (const server of healthy) {
      random -= server.weight;
      if (random <= 0) return server;
    }

    return healthy[0];
  }

  /**
   * IP Hash вибір.
   */
  nextIpHash(ip: string): Server | null {
    const healthy = this.servers.filter((s) => s.healthy);
    if (healthy.length === 0) return null;

    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      hash = ((hash << 5) - hash + ip.charCodeAt(i)) | 0;
    }

    return healthy[Math.abs(hash) % healthy.length];
  }

  /**
   * Позначити сервер як healthy/unhealthy.
   */
  setHealth(id: string, healthy: boolean): void {
    const server = this.servers.find((s) => s.id === id);
    if (server) server.healthy = healthy;
  }

  /**
   * Отримати список серверів.
   */
  getServers(): Server[] {
    return [...this.servers];
  }
}
