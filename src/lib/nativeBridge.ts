/**
 * جسر تكامل خفيف يدعم تشغيل التطبيق داخل APK أندرويد أصلي (عبر window.AndroidApp)
 * مع التراجع التلقائي لواجهات المتصفح القياسية (PWA / Web).
 */
export interface AndroidAppBridge {
  getNotificationPermission?: () => string;
  requestNotificationPermission?: () => void;
  showNotification?: (title: string, body: string, tag: string, orderId: string) => boolean;
  saveBackup?: (filename: string, jsonContent: string) => boolean;
  shareText?: (title: string, text: string) => boolean;
  printPage?: (jobName: string) => boolean;
}

declare global {
  interface Window {
    AndroidApp?: AndroidAppBridge;
    __onNativeNotificationPermissionResult?: (permission: NotificationPermission) => void;
    __onNativeToast?: (message: string) => void;
    __handleAndroidBack?: () => boolean;
    __openOrderFromNotification?: (orderId: string) => void;
  }
}

export const getAndroidBridge = (): AndroidAppBridge | undefined =>
  typeof window !== "undefined" ? window.AndroidApp : undefined;

export const isAndroidApp = (): boolean => Boolean(getAndroidBridge());

export const supportsSystemNotifications = (): boolean => {
  if (typeof window === "undefined") return false;
  if (window.AndroidApp?.showNotification) return true;
  return "Notification" in window;
};

const normalizePermission = (value: unknown): NotificationPermission => {
  if (value === "granted" || value === "denied" || value === "default") return value;
  return "default";
};

export const getSystemNotificationPermission = (): NotificationPermission => {
  const bridge = getAndroidBridge();
  if (bridge?.getNotificationPermission) {
    try {
      return normalizePermission(bridge.getNotificationPermission());
    } catch {
      return "denied";
    }
  }
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "denied";
};

export const requestSystemNotificationPermission = (): Promise<NotificationPermission> => {
  const bridge = getAndroidBridge();
  if (bridge?.requestNotificationPermission) {
    return new Promise<NotificationPermission>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(getSystemNotificationPermission());
        }
      }, 15000);

      window.__onNativeNotificationPermissionResult = (perm: NotificationPermission) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve(normalizePermission(perm));
        }
      };

      try {
        bridge.requestNotificationPermission?.();
      } catch {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve("denied");
        }
      }
    });
  }

  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.requestPermission();
  }

  return Promise.resolve("denied");
};

export const showSystemNotification = async (
  title: string,
  body: string,
  tag: string,
  orderId?: string,
): Promise<boolean> => {
  const bridge = getAndroidBridge();
  if (bridge?.showNotification) {
    try {
      if (getSystemNotificationPermission() !== "granted") return false;
      return Boolean(bridge.showNotification(title, body, tag, orderId ?? ""));
    } catch {
      return false;
    }
  }

  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const options: NotificationOptions = {
    body,
    icon: "./icon-512.png",
    badge: "./icon-512.png",
    tag,
    data: {
      url: orderId ? `/?page=archive&orderId=${orderId}` : "/?page=home",
      orderId,
    },
  };

  try {
    const registration =
      "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;

    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
    return true;
  } catch {
    return false;
  }
};

export const saveBackupData = (filename: string, jsonContent: string): "native" | "browser" | "failed" => {
  const bridge = getAndroidBridge();
  if (bridge?.saveBackup) {
    try {
      const ok = bridge.saveBackup(filename, jsonContent);
      if (ok) return "native";
    } catch {
      // التراجع للطريقة العادية عند أي خطأ غير متوقع
    }
  }

  try {
    const blob = new Blob([jsonContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return "browser";
  } catch {
    return "failed";
  }
};

export const shareOrderSummary = async (title: string, text: string): Promise<"shared" | "copied" | "failed"> => {
  const bridge = getAndroidBridge();
  if (bridge?.shareText) {
    try {
      if (bridge.shareText(title, text)) return "shared";
    } catch {
      // التراجع لواجهة المتصفح
    }
  }

  try {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav && typeof nav.share === "function") {
      await nav.share({ title, text });
      return "shared";
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return "copied";
    }
    return "failed";
  } catch {
    return "failed";
  }
};

export const printOrderCard = (jobName: string): boolean => {
  const bridge = getAndroidBridge();
  if (bridge?.printPage) {
    try {
      return Boolean(bridge.printPage(jobName));
    } catch {
      return false;
    }
  }

  if (typeof window !== "undefined" && typeof window.print === "function") {
    window.setTimeout(() => window.print(), 100);
    return true;
  }
  return false;
};
