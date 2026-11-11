import { describe, expect, it } from "vitest";
import { fixOrder, type NotificationSettings, type Order } from "./orders";
import {
  MAX_INDIVIDUAL_ALERTS,
  alertLabel,
  buildAlertFeed,
  getPendingAlerts,
  mergeNotifiedKeys,
  planReminderNotifications,
} from "./notifications";

const DAY = "2026-11-11";

const settings: NotificationSettings = {
  enabled: true,
  today: true,
  tomorrow: true,
  overdue: true,
};

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  fixOrder({ id: "o1", name: "أحمد", ...overrides });

describe("buildAlertFeed", () => {
  it("يعطي تنبيهاً للمتأخر واليوم وغداً", () => {
    const orders = [
      makeOrder({ id: "late", name: "متأخر", delivery: "2026-11-09" }),
      makeOrder({ id: "now", name: "اليوم", delivery: DAY }),
      makeOrder({ id: "next", name: "غداً", delivery: "2026-11-12" }),
    ];

    const feed = buildAlertFeed(orders, settings, DAY);

    expect(feed.map((a) => a.orderId).sort()).toEqual(["late", "next", "now"]);
    expect(feed.find((a) => a.orderId === "late")?.kind).toBe("overdue");
    expect(feed.find((a) => a.orderId === "now")?.kind).toBe("today");
    expect(feed.find((a) => a.orderId === "next")?.kind).toBe("tomorrow");
  });

  it("يستثني الطلبات المسلّمة والطلبات بلا تاريخ استلام", () => {
    const orders = [
      makeOrder({ id: "done", status: "تم التسليم", delivery: DAY }),
      makeOrder({ id: "none", delivery: "" }),
      makeOrder({ id: "later", delivery: "2026-12-01" }),
    ];

    expect(buildAlertFeed(orders, settings, DAY)).toHaveLength(0);
  });

  it("يحترم إعدادات كل نوع تنبيه", () => {
    const orders = [
      makeOrder({ id: "late", delivery: "2026-11-09" }),
      makeOrder({ id: "now", delivery: DAY }),
      makeOrder({ id: "next", delivery: "2026-11-12" }),
    ];

    expect(buildAlertFeed(orders, { ...settings, overdue: false }, DAY).map((a) => a.kind)).not.toContain("overdue");
    expect(buildAlertFeed(orders, { ...settings, today: false }, DAY).map((a) => a.kind)).not.toContain("today");
    expect(buildAlertFeed(orders, { ...settings, tomorrow: false }, DAY).map((a) => a.kind)).not.toContain("tomorrow");
    expect(buildAlertFeed(orders, { ...settings, today: false, overdue: false, tomorrow: false }, DAY)).toHaveLength(0);
  });

  it("يرتب التنبيهات: المتأخر ثم اليوم ثم غداً", () => {
    const orders = [
      makeOrder({ id: "next", delivery: "2026-11-12" }),
      makeOrder({ id: "now", delivery: DAY }),
      makeOrder({ id: "late", delivery: "2026-01-01" }),
    ];

    expect(buildAlertFeed(orders, settings, DAY).map((a) => a.kind)).toEqual(["overdue", "today", "tomorrow"]);
  });

  it("يعطي مفتاحاً مختلفاً للمتأخر كل يوم (تذكير يومي مرة واحدة)", () => {
    const [order] = [makeOrder({ id: "late", delivery: "2026-11-09" })];
    const firstDay = buildAlertFeed([order], settings, DAY)[0];
    const nextDay = buildAlertFeed([order], settings, "2026-11-12")[0];

    expect(firstDay.key).toBe(`overdue:late:${DAY}`);
    expect(nextDay.key).toBe("overdue:late:2026-11-12");
    expect(firstDay.key).not.toBe(nextDay.key);
  });

  it("يعرض بديلاً عندما يكون اسم العميل فارغاً", () => {
    const feed = buildAlertFeed([makeOrder({ id: "x", name: "", delivery: DAY })], settings, DAY);
    expect(feed[0].title).toContain("عميل بدون اسم");
    expect(feed[0].body).toContain("11/11/2026");
  });

  it("ينتقل تاريخ الغد بشكل صحيح في نهاية الشهر", () => {
    const order = makeOrder({ delivery: "2026-12-01" });
    const feed = buildAlertFeed([order], settings, "2026-11-30");
    expect(feed[0].kind).toBe("tomorrow");
  });
});

describe("getPendingAlerts", () => {
  it("يستبعد الأحداث التي أُرسل إشعارها مسبقاً", () => {
    const orders = [
      makeOrder({ id: "a", delivery: DAY }),
      makeOrder({ id: "b", delivery: DAY }),
    ];
    const feed = buildAlertFeed(orders, settings, DAY);

    const pending = getPendingAlerts(feed, [feed[0].key]);

    expect(pending).toHaveLength(1);
    expect(pending[0].key).toBe(feed[1].key);
  });

  it("يرجع القائمة كاملة عندما لا يوجد شيء مرسل", () => {
    const feed = buildAlertFeed([makeOrder({ delivery: DAY })], settings, DAY);
    expect(getPendingAlerts(feed, [])).toHaveLength(1);
  });
});

describe("planReminderNotifications", () => {
  const makeFeed = (count: number) =>
    buildAlertFeed(
      Array.from({ length: count }, (_, i) => makeOrder({ id: `o${i}`, name: `عميل ${i}`, delivery: DAY })),
      settings,
      DAY,
    );

  it("يرسل حتى ثلاثة تنبيهات منفصلة فقط", () => {
    const plan = planReminderNotifications(makeFeed(3), "خياطة العمر");
    expect(plan.individual).toHaveLength(MAX_INDIVIDUAL_ALERTS);
    expect(plan.summary).toBeNull();
  });

  it("يجمع الباقي في إشعار واحد مع مفاتيحه", () => {
    const pending = makeFeed(5);
    const plan = planReminderNotifications(pending, "خياطة العمر");

    expect(plan.individual).toHaveLength(3);
    expect(plan.summary).not.toBeNull();
    expect(plan.summary?.title).toContain("5");
    expect(plan.summary?.keys).toEqual(pending.slice(3).map((a) => a.key));
  });

  it("لا ينتج أي خطة عند عدم وجود تنبيهات", () => {
    const plan = planReminderNotifications([], "خياطة العمر");
    expect(plan.individual).toHaveLength(0);
    expect(plan.summary).toBeNull();
  });
});

describe("mergeNotifiedKeys", () => {
  it("يزيل التكرار ويحافظ على الحد الأقصى", () => {
    expect(mergeNotifiedKeys(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeNotifiedKeys(["1", "2", "3"], ["4"], 3)).toEqual(["2", "3", "4"]);
  });
});

describe("alertLabel", () => {
  it("يعطي تسمية عربية لكل نوع", () => {
    expect(alertLabel("overdue")).toBe("متأخر");
    expect(alertLabel("today")).toBe("اليوم");
    expect(alertLabel("tomorrow")).toBe("غداً");
  });
});
