/**
 * SYSTEM DJ — Notification Center
 * Registro ligero en memoria de eventos del sistema (importación, análisis, sesiones).
 * Los mensajes se guardan como clave i18n + parámetros para traducirse al renderizar.
 * No persiste entre recargas ni depende de servicios externos.
 */

export type NotificationType = 'success' | 'warning' | 'error';

export interface AppNotification {
  id: number;
  type: NotificationType;
  messageKey: string;
  params?: Record<string, string | number>;
  createdAt: number;
  read: boolean;
}

export interface NotificationInput {
  type: NotificationType;
  messageKey: string;
  params?: Record<string, string | number>;
}

type NotificationListener = () => void;

const MAX_NOTIFICATIONS = 20;

export class NotificationCenter {
  private notifications: readonly AppNotification[] = [];
  private listeners: Set<NotificationListener> = new Set();
  private nextId = 1;

  public push(input: NotificationInput): AppNotification {
    const notification: AppNotification = {
      ...input,
      id: this.nextId++,
      createdAt: Date.now(),
      read: false,
    };
    this.notifications = [notification, ...this.notifications].slice(0, MAX_NOTIFICATIONS);
    this.emit();
    return notification;
  }

  public markAllRead(): void {
    if (!this.notifications.some((n) => !n.read)) return;
    this.notifications = this.notifications.map((n) => (n.read ? n : { ...n, read: true }));
    this.emit();
  }

  public clear(): void {
    if (this.notifications.length === 0) return;
    this.notifications = [];
    this.emit();
  }

  /** Instantánea inmutable compatible con useSyncExternalStore. */
  public getSnapshot = (): readonly AppNotification[] => this.notifications;

  public subscribe = (listener: NotificationListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const notificationCenter = new NotificationCenter();
