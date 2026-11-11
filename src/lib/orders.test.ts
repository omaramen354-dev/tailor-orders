import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ALL,
  SECS,
  blank,
  fixOrder,
  fmtDate,
  money,
  sortOrders,
  toNum,
  type Order,
} from "./orders";

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  fixOrder({ name: "أحمد", total: "1000", paid: "400", ...overrides });

afterEach(() => {
  vi.useRealTimers();
});

describe("toNum", () => {
  it("يستخرج الرقم من نص فيه عملة أو فواصل", () => {
    expect(toNum("1,500 ل.س")).toBe(1500);
    expect(toNum("250.5")).toBe(250.5);
    expect(toNum("السعر 300")).toBe(300);
  });

  it("يرجع صفراً للقيم الفارغة أو غير الصالحة", () => {
    expect(toNum("")).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(null)).toBe(0);
    expect(toNum("abc")).toBe(0);
  });

  it("يتعامل مع الأرقام القادمة من نسخة احتياطية قديمة", () => {
    expect(toNum(500)).toBe(500);
  });
});

describe("fmtDate", () => {
  it("يحوّل تاريخ ISO إلى صيغة يوم/شهر/سنة", () => {
    expect(fmtDate("2026-11-11")).toBe("11/11/2026");
  });

  it("يتعامل مع القيم الفارغة أو غير المتوقعة", () => {
    expect(fmtDate("")).toBe("—");
    expect(fmtDate("غير معروف")).toBe("غير معروف");
  });
});

describe("money", () => {
  it("يضيف الليرة السورية ولا ينتج NaN", () => {
    const out = money(1500);
    expect(out.endsWith(" ل.س")).toBe(true);
    expect(out).not.toContain("NaN");
  });
});

describe("fixOrder", () => {
  it("يبني طلباً صالحاً من كائن فارغ", () => {
    const order = fixOrder({});
    expect(order.id).toBeTruthy();
    expect(order.name).toBe("");
    expect(order.pieces).toBe("1");
    expect(order.status).toBe("جديد");
    expect(order.created).toBeTruthy();
    expect(order.updated).toBeTruthy();
  });

  it("يضمن وجود كل حقول القياسات", () => {
    const order = fixOrder({});
    for (const section of SECS) {
      for (const field of section.fields) {
        expect(order.m[section.key][field.id]).toBe("");
      }
    }
  });

  it("يستبدل الحالة غير المعروفة بحالة جديدة", () => {
    expect(fixOrder({ status: "ملغي" as Order["status"] }).status).toBe("جديد");
    for (const status of ALL) {
      expect(fixOrder({ status }).status).toBe(status);
    }
  });

  it("يحافظ على القياسات والقيم الصحيحة", () => {
    const order = makeOrder({
      m: { thobe: { len: "145", sh: "18" } } as Order["m"],
    });
    expect(order.m.thobe.len).toBe("145");
    expect(order.m.thobe.sh).toBe("18");
    expect(order.m.thobe.sl).toBe("");
    expect(order.m.jacket.len).toBe("");
  });

  it("يحوّل الأرقام النصية القادمة من ملف نسخة احتياطية إلى نصوص", () => {
    const order = fixOrder({ total: 2500 as unknown as string, paid: 1000 as unknown as string });
    expect(order.total).toBe("2500");
    expect(order.paid).toBe("1000");
    expect(toNum(order.total) - toNum(order.paid)).toBe(1500);
  });

  it("يتجاهل قوائم القياسات التالفة", () => {
    const order = fixOrder({ m: null as unknown as Order["m"] });
    expect(order.m.thobe.len).toBe("");
  });
});

describe("blank", () => {
  it("ينشئ معرفاً فريداً وتاريخ استلام بعد أسبوع", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));

    const a = blank();
    const b = blank();

    expect(a.id).not.toBe(b.id);
    expect(a.date).toBe("2026-11-11");
    expect(a.delivery).toBe("2026-11-18");
    expect(a.status).toBe("جديد");
  });
});

describe("sortOrders", () => {
  it("يرتب الأحدث تعديلاً أولاً دون تغيير المصفوفة الأصلية", () => {
    const older = makeOrder({ id: "a", updated: "2026-01-01T00:00:00.000Z" });
    const newer = makeOrder({ id: "b", updated: "2026-06-01T00:00:00.000Z" });
    const list = [older, newer];

    const sorted = sortOrders(list);

    expect(sorted.map((o) => o.id)).toEqual(["b", "a"]);
    expect(list.map((o) => o.id)).toEqual(["a", "b"]);
  });
});
