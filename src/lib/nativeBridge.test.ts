// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSystemNotificationPermission,
  isAndroidApp,
  printOrderCard,
  requestSystemNotificationPermission,
  saveBackupData,
  shareOrderSummary,
  showSystemNotification,
  supportsSystemNotifications,
} from "./nativeBridge";

afterEach(() => {
  delete window.AndroidApp;
  delete window.__onNativeNotificationPermissionResult;
  vi.restoreAllMocks();
});

describe("nativeBridge (Android APK & Browser)", () => {
  it("يكتشف جسر الأندرويد عند تشغيل التطبيق داخل الـ APK", () => {
    expect(isAndroidApp()).toBe(false);
    window.AndroidApp = {
      getNotificationPermission: () => "granted",
      showNotification: () => true,
    };
    expect(isAndroidApp()).toBe(true);
    expect(supportsSystemNotifications()).toBe(true);
    expect(getSystemNotificationPermission()).toBe("granted");
  });

  it("يطلب إذن الإشعارات ويرسل إشعاراً عبر جسر الأندرويد", async () => {
    const showNotification = vi.fn(() => true);
    let perm = "default";
    window.AndroidApp = {
      getNotificationPermission: () => perm,
      requestNotificationPermission: () => {
        perm = "granted";
        window.__onNativeNotificationPermissionResult?.("granted");
      },
      showNotification,
    };

    const result = await requestSystemNotificationPermission();
    expect(result).toBe("granted");

    const sent = await showSystemNotification("تسليم اليوم", "طلب أحمد جاهز", "today:1", "o1");
    expect(sent).toBe(true);
    expect(showNotification).toHaveBeenCalledWith("تسليم اليوم", "طلب أحمد جاهز", "today:1", "o1");
  });

  it("يحفظ النسخة الاحتياطية ويشارك ويطبع عبر الأندرويد عند توفر الجسر", async () => {
    const saveBackup = vi.fn(() => true);
    const shareText = vi.fn(() => true);
    const printPage = vi.fn(() => true);
    window.AndroidApp = { saveBackup, shareText, printPage };

    expect(saveBackupData("backup.json", "[]")).toBe("native");
    expect(saveBackup).toHaveBeenCalledWith("backup.json", "[]");

    expect(await shareOrderSummary("خياطة العمر", "تفاصيل الطلب")).toBe("shared");
    expect(shareText).toHaveBeenCalledWith("خياطة العمر", "تفاصيل الطلب");

    expect(printOrderCard("بطاقة أحمد")).toBe(true);
    expect(printPage).toHaveBeenCalledWith("بطاقة أحمد");
  });
});
