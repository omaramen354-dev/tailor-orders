import { addD, fmtDate, sortOrders, today, type NotificationSettings, type Order, type Status } from "./orders";

export type AlertKind = "today" | "tomorrow" | "overdue";

export interface AlertItem {
  key: string;
  kind: AlertKind;
  orderId: string;
  customerName: string;
  title: string;
  body: string;
  delivery: string;
  status: Status;
}

/** الحد الأقصى للإشعارات المنفصلة قبل تجميع الباقي في إشعار واحد. */
export const MAX_INDIVIDUAL_ALERTS = 3;

/** يزحف يوماً واحداً على تاريخ ISO بشكل ثابت (UTC) دون تأثر بالمنطقة الزمنية. */
const shiftDay = (isoDay: string, days: number) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const alertTone = (kind: AlertKind): string =>
  ({
    overdue: "bg-red-50 border-red-200 text-red-700",
    today: "bg-amber-50 border-amber-200 text-amber-700",
    tomorrow: "bg-sky-50 border-sky-200 text-sky-700",
  })[kind];

export const alertLabel = (kind: AlertKind): string =>
  ({ overdue: "متأخر", today: "اليوم", tomorrow: "غداً" })[kind];

/**
 * يبني قائمة التنبيهات الحالية للطلبات غير المسلّمة.
 * `currentDay` قابل للتمرير حتى يكون الاختبار ثابتاً، والافتراضي هو تاريخ اليوم.
 */
export const buildAlertFeed = (
  orders: Order[],
  settings: NotificationSettings,
  currentDay: string = today(),
): AlertItem[] => {
  const tomorrowDay = currentDay === today() ? addD(1) : shiftDay(currentDay, 1);

  const list = sortOrders(orders)
    .filter((order) => order.status !== "تم التسليم")
    .flatMap<AlertItem>((order) => {
      if (!order.delivery) return [];

      const who = order.name || "عميل بدون اسم";

      if (settings.overdue && order.delivery < currentDay) {
        return [
          {
            key: `overdue:${order.id}:${currentDay}`,
            kind: "overdue",
            orderId: order.id,
            customerName: order.name,
            title: `طلب متأخر: ${who}`,
            body: `موعد التسليم كان ${fmtDate(order.delivery)}. افتح التطبيق للمتابعة.`,
            delivery: order.delivery,
            status: order.status,
          },
        ];
      }

      if (settings.today && order.delivery === currentDay) {
        return [
          {
            key: `today:${order.id}:${order.delivery}`,
            kind: "today",
            orderId: order.id,
            customerName: order.name,
            title: `تسليم اليوم: ${who}`,
            body: `لديك موعد تسليم اليوم بتاريخ ${fmtDate(order.delivery)}.`,
            delivery: order.delivery,
            status: order.status,
          },
        ];
      }

      if (settings.tomorrow && order.delivery === tomorrowDay) {
        return [
          {
            key: `tomorrow:${order.id}:${order.delivery}`,
            kind: "tomorrow",
            orderId: order.id,
            customerName: order.name,
            title: `تذكير الغد: ${who}`,
            body: `لديك طلب مقرر تسليمه غداً ${fmtDate(order.delivery)}.`,
            delivery: order.delivery,
            status: order.status,
          },
        ];
      }

      return [];
    });

  const priority: Record<AlertKind, number> = { overdue: 0, today: 1, tomorrow: 2 };
  return list.sort((a, b) => priority[a.kind] - priority[b.kind]);
};

/** التنبيهات التي لم يُرسل إشعارها بعد، اعتماداً على مفاتيح الأحداث المرسلة. */
export const getPendingAlerts = (feed: AlertItem[], notifiedKeys: Iterable<string>): AlertItem[] => {
  const seen = new Set(notifiedKeys);
  return feed.filter((alert) => !seen.has(alert.key));
};

export interface ReminderSummary {
  title: string;
  body: string;
  keys: string[];
}

export interface ReminderPlan {
  individual: AlertItem[];
  summary: ReminderSummary | null;
}

/** يوزّع التنبيهات المعلّقة على إشعارات منفصلة + إشعار تجميعي للباقي. */
export const planReminderNotifications = (pending: AlertItem[], storeName: string): ReminderPlan => {
  const individual = pending.slice(0, MAX_INDIVIDUAL_ALERTS);
  const rest = pending.slice(MAX_INDIVIDUAL_ALERTS);

  return {
    individual,
    summary: rest.length
      ? {
          title: `لديك ${pending.length} تنبيهات في ${storeName}`,
          body: "افتح التطبيق لمراجعة الطلبات المستحقة أو المتأخرة.",
          keys: rest.map((alert) => alert.key),
        }
      : null,
  };
};

/** يضيف مفاتيح الأحداث المرسلة دون تكرار ويحافظ على آخر 500 مفتاح. */
export const mergeNotifiedKeys = (prev: string[], keys: string[], limit = 500): string[] =>
  Array.from(new Set([...prev, ...keys])).slice(-limit);
