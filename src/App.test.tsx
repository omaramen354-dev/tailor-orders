// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { DB, fixOrder, today } from "./lib/orders";

beforeEach(() => {
  localStorage.clear();
  delete window.AndroidApp;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App UI & User Flows", () => {
  it("يعرض الشاشة الرئيسية ويمنع حفظ طلب بدون اسم عميل", () => {
    render(<App />);
    expect(screen.getByText("خياطة وأقمشة العمر")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /طلب جديد/ }));
    fireEvent.click(screen.getByRole("button", { name: /حفظ الطلب/ }));

    expect(screen.getByRole("status").textContent).toContain("أدخل اسم العميل أولاً");
  });

  it("يضيف طلباً كاملاً مع القياسات والأرقام العربية ويحفظه في التخزين المحلي", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /طلب جديد/ }));

    fireEvent.change(screen.getByLabelText("الاسم"), { target: { value: "محمود الشامي" } });
    fireEvent.change(screen.getByLabelText("رقم الهاتف"), { target: { value: "٠٩٣٣١١٢٢٣٣" } });
    fireEvent.change(screen.getByLabelText("نوع القماش"), { target: { value: "صوف إنجليزي" } });
    fireEvent.change(screen.getByLabelText("القيمة الكلية"), { target: { value: "٢٥٠٠٠٠" } });
    fireEvent.change(screen.getByLabelText("المبلغ المدفوع"), { target: { value: "١٠٠٠٠٠" } });

    const thobeLen = document.getElementById("meas-thobe-len") as HTMLInputElement;
    fireEvent.change(thobeLen, { target: { value: "١٤٨" } });

    fireEvent.click(screen.getByRole("button", { name: /قيد التنفيذ/ }));
    fireEvent.click(screen.getByRole("button", { name: /حفظ الطلب/ }));

    expect(screen.getByText("سجل الطلبات")).toBeTruthy();
    expect(screen.getByText("محمود الشامي")).toBeTruthy();

    const stored = JSON.parse(localStorage.getItem(DB) || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("محمود الشامي");
    expect(stored[0].phone).toBe("0933112233");
    expect(stored[0].total).toBe("250000");
    expect(stored[0].paid).toBe("100000");
    expect(stored[0].m.thobe.len).toBe("148");
    expect(stored[0].status).toBe("قيد التنفيذ");
  });

  it("يحافظ على البيانات المدخلة عند الانتقال للمعاينة ثم العودة عبر شريط التنقل السفلي", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /طلب جديد/ }));
    fireEvent.change(screen.getByLabelText("الاسم"), { target: { value: "خالد العلي" } });
    const jacketChest = document.getElementById("meas-jacket-ch") as HTMLInputElement;
    fireEvent.change(jacketChest, { target: { value: "48" } });

    fireEvent.click(screen.getByRole("button", { name: /👁️ معاينة/ }));
    expect(screen.getByText("معاينة البطاقة")).toBeTruthy();
    expect(screen.getByText("خالد العلي")).toBeTruthy();

    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: /بطاقة/ }));

    expect((screen.getByLabelText("الاسم") as HTMLInputElement).value).toBe("خالد العلي");
    expect((document.getElementById("meas-jacket-ch") as HTMLInputElement).value).toBe("48");
  });

  it("يدعم البحث والتصفية والحذف الآمن عبر نافذة التأكيد", () => {
    const orders = [
      fixOrder({ id: "o1", name: "سامر حلبي", phone: "0944000111", fabric: "كتان", status: "جاهز", total: "50000", paid: "50000" }),
      fixOrder({ id: "o2", name: "فارس دمشقي", phone: "0955222333", fabric: "صوف", status: "جديد", total: "80000", paid: "20000" }),
    ];
    localStorage.setItem(DB, JSON.stringify(orders));

    render(<App />);
    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: /السجل/ }));

    // تصفية حسب الحالة "جاهز"
    fireEvent.click(screen.getByRole("button", { name: /جاهز \(1\)/ }));
    expect(screen.getByText("سامر حلبي")).toBeTruthy();
    expect(screen.queryByText("فارس دمشقي")).toBeNull();

    // إعادة الكل والبحث بالأرقام العربية
    fireEvent.click(screen.getByRole("button", { name: /الكل \(2\)/ }));
    fireEvent.change(screen.getByLabelText("بحث في الطلبات"), { target: { value: "٠٩٥٥" } });
    expect(screen.getByText("فارس دمشقي")).toBeTruthy();
    expect(screen.queryByText("سامر حلبي")).toBeNull();

    // فتح البطاقة وحذفها عبر نافذة التأكيد
    fireEvent.click(screen.getByText("فارس دمشقي"));
    fireEvent.click(screen.getByLabelText("حذف طلب فارس دمشقي"));

    const dialog = screen.getByRole("dialog", { name: "تأكيد حذف الطلب" });
    expect(dialog).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد الحذف" }));

    expect(screen.queryByText("فارس دمشقي")).toBeNull();
    expect(JSON.parse(localStorage.getItem(DB) || "[]")).toHaveLength(1);
  });

  it("يدعم استيراد نسخة احتياطية JSON ويدير زر الرجوع والإشعارات في الأندرويد", async () => {
    const dueOrder = fixOrder({
      id: "due-1",
      name: "نبيل عطار",
      delivery: today(),
      status: "جاهز",
      total: "90000",
      paid: "40000",
    });
    localStorage.setItem(DB, JSON.stringify([dueOrder]));

    render(<App />);

    // يظهر تنبيه تسليم اليوم في الرئيسية
    expect(screen.getByText("تنبيه: تسليم اليوم")).toBeTruthy();

    // الانتقال إلى السجل واستيراد ملف JSON
    const nav = screen.getByRole("navigation");
    fireEvent.click(within(nav).getByRole("button", { name: /السجل/ }));
    const fileInput = screen.getByTestId("backup-file-input") as HTMLInputElement;
    const backupPayload = JSON.stringify([
      { id: "imp-1", name: "عميل مستورد", phone: "0999888777", total: "120000", paid: "60000", status: "جاهز" },
    ]);
    const file = new File([backupPayload], "backup.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("عميل مستورد")).toBeTruthy();
    });

    // فحص سلوك زر الرجوع في APK الأندرويد: من السجل -> الرئيسية -> الخروج
    let handled = false;
    act(() => {
      handled = Boolean(window.__handleAndroidBack?.());
    });
    expect(handled).toBe(true);
    expect(screen.getByText("الإجراءات السريعة")).toBeTruthy();

    act(() => {
      handled = Boolean(window.__handleAndroidBack?.());
    });
    expect(handled).toBe(false);

    // فحص فتح طلب محدد عند النقر على إشعار أندرويد
    act(() => {
      window.__openOrderFromNotification?.("imp-1");
    });
    expect(screen.getByText("سجل الطلبات")).toBeTruthy();
    expect(screen.getByText("عميل مستورد")).toBeTruthy();
  });
});
