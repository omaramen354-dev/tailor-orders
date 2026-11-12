/* ══════════════════════ TYPES ══════════════════════ */
export type Page = "home" | "form" | "archive" | "preview";
export type Status = "جديد" | "قيد التنفيذ" | "جاهز" | "تم التسليم";
export type Meas = Record<string, Record<string, string>>;

export interface Order {
  id: string;
  name: string;
  phone: string;
  total: string;
  paid: string;
  date: string;
  delivery: string;
  fabric: string;
  pieces: string;
  status: Status;
  notes: string;
  m: Meas;
  created: string;
  updated: string;
}

export interface MF {
  id: string;
  label: string;
  ph: string;
}

export interface MS {
  key: string;
  title: string;
  icon: string;
  fields: MF[];
}

export interface NotificationSettings {
  enabled: boolean;
  today: boolean;
  tomorrow: boolean;
  overdue: boolean;
}

/* ══════════════════════ CONSTANTS ══════════════════════ */
export const STORE = {
  name: "خياطة وأقمشة العمر",
  desc: "صناعة وتجارة الألبسة الجاهزة والتفصيل",
  mgr: "بلال",
  tel: "0930652900",
};

export const DB = "tailor-db-v3";
export const NOTIFICATION_SETTINGS_KEY = "tailor-notification-settings-v1";
export const NOTIFIED_EVENTS_KEY = "tailor-notified-events-v1";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  today: true,
  tomorrow: true,
  overdue: true,
};

export const ALL: Status[] = ["جديد", "قيد التنفيذ", "جاهز", "تم التسليم"];

export const SECS: MS[] = [
  {
    key: "thobe",
    title: "الثوب / القميص",
    icon: "👔",
    fields: [
      { id: "len", label: "الطول", ph: "145" },
      { id: "sh", label: "الكتف", ph: "18" },
      { id: "sl", label: "طول الكم", ph: "24" },
      { id: "bd", label: "البدن", ph: "44" },
      { id: "nk", label: "رقبة", ph: "16" },
      { id: "sn", label: "سنارة", ph: "8" },
      { id: "hm", label: "شليل", ph: "12" },
    ],
  },
  {
    key: "jacket",
    title: "الجاكيت",
    icon: "🧥",
    fields: [
      { id: "len", label: "طول", ph: "80" },
      { id: "sh", label: "كتف", ph: "19" },
      { id: "sl", label: "طول الكم", ph: "25" },
      { id: "ch", label: "دوران صدر", ph: "46" },
      { id: "bl", label: "دوران بطن", ph: "42" },
      { id: "ar", label: "دوران كم", ph: "15" },
    ],
  },
  {
    key: "pants",
    title: "البنطال",
    icon: "👖",
    fields: [
      { id: "len", label: "طول", ph: "105" },
      { id: "ws", label: "خصر", ph: "36" },
      { id: "hp", label: "الورك", ph: "44" },
      { id: "lg", label: "حجل", ph: "8" },
      { id: "md", label: "موديل", ph: "كلاسيك" },
      { id: "nt", label: "ملاحظة", ph: "تعديل" },
    ],
  },
];

/* ══════════════════════ HELPERS ══════════════════════ */
export const nowISO = () => new Date().toISOString();

/** يحوّل كائن التاريخ إلى YYYY-MM-DD حسب التوقيت المحلي للجهاز بدقة. */
export const toLocalISODate = (date: Date = new Date()): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const today = () => toLocalISODate(new Date());

export const addD = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return toLocalISODate(x);
};

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** يوحّد الأرقام العربية/الفارسية (٠-٩ / ۰-۹) والفاصلة العشرية العربية إلى أرقام قياسية. */
export const normalizeDigits = (input: string): string =>
  input
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".");

/** يحوّل أي قيمة قادمة من نموذج أو لوحة مفاتيح عربية أو ملف نسخة احتياطية إلى رقم آمن. */
export const toNum = (v: unknown) => {
  const cleaned = normalizeDigits(String(v ?? "")).replace(/[^\d.]/g, "");
  if (!cleaned) return 0;
  const [intPart, ...rest] = cleaned.split(".");
  const normalized = rest.length > 0 ? `${intPart}.${rest.join("")}` : intPart;
  const r = Number(normalized);
  return Number.isFinite(r) ? r : 0;
};

export const money = (v: number) => v.toLocaleString("ar-EG") + " ل.س";

export const fmtDate = (v: string) => {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return d && m && y ? `${d}/${m}/${y}` : v;
};

const asText = (v: unknown, fallback = ""): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
};

export const emptyM = (): Meas =>
  SECS.reduce<Meas>((a, s) => {
    a[s.key] = s.fields.reduce<Record<string, string>>((b, f) => {
      b[f.id] = "";
      return b;
    }, {});
    return a;
  }, {});

export const blank = (): Order => ({
  id: uid(),
  name: "",
  phone: "",
  total: "",
  paid: "",
  date: today(),
  delivery: addD(7),
  fabric: "",
  pieces: "1",
  status: "جديد",
  notes: "",
  m: emptyM(),
  created: nowISO(),
  updated: nowISO(),
});

/** يرمّم أي طلب (من التخزين المحلي أو نسخة احتياطية) إلى شكل صالح دائماً حتى لو كان تالفاً. */
export const fixOrder = (r: Partial<Order> | null | undefined): Order => {
  const safe: Partial<Order> = r && typeof r === "object" && !Array.isArray(r) ? r : {};
  const b = blank();
  const rawMeas = safe.m && typeof safe.m === "object" && !Array.isArray(safe.m) ? safe.m : undefined;
  const ms = SECS.reduce<Meas>((a, s) => {
    const rawSec = rawMeas?.[s.key];
    const secObj = rawSec && typeof rawSec === "object" && !Array.isArray(rawSec) ? rawSec : undefined;
    a[s.key] = s.fields.reduce<Record<string, string>>((acc, f) => {
      acc[f.id] = asText(secObj?.[f.id]);
      return acc;
    }, {});
    return a;
  }, {});

  return {
    ...b,
    ...safe,
    id: asText(safe.id) || b.id,
    name: asText(safe.name),
    phone: asText(safe.phone),
    total: asText(safe.total),
    paid: asText(safe.paid),
    date: asText(safe.date) || b.date,
    delivery: asText(safe.delivery) || b.delivery,
    fabric: asText(safe.fabric),
    pieces: asText(safe.pieces, "1") || "1",
    status: ALL.includes(safe.status as Status) ? (safe.status as Status) : "جديد",
    notes: asText(safe.notes),
    m: ms,
    created: asText(safe.created) || b.created,
    updated: asText(safe.updated) || b.updated,
  };
};

export const sortOrders = (l: Order[]) => [...l].sort((a, b) => b.updated.localeCompare(a.updated));

export interface MergeOrdersResult {
  orders: Order[];
  added: number;
  updated: number;
}

/** يدمج طلبات النسخة الاحتياطية مع الحالية مع تحديث الطلبات الأحدث وتجاهل العناصر التالفة. */
export const mergeImportedOrders = (existing: Order[], rawItems: unknown[]): MergeOrdersResult => {
  const byId = new Map<string, Order>();
  for (const o of existing) {
    byId.set(o.id, o);
  }

  let added = 0;
  let updated = 0;

  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const incoming = fixOrder(item as Partial<Order>);
    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      added += 1;
    } else if (incoming.updated > current.updated) {
      byId.set(incoming.id, incoming);
      updated += 1;
    }
  }

  return {
    orders: sortOrders(Array.from(byId.values())),
    added,
    updated,
  };
};

export const sColor = (s: Status): string =>
  ({
    جديد: "bg-blue-100 text-blue-700",
    "قيد التنفيذ": "bg-amber-100 text-amber-700",
    جاهز: "bg-emerald-100 text-emerald-700",
    "تم التسليم": "bg-gray-100 text-gray-500",
  })[s];

export const sIcon = (s: Status): string =>
  ({ جديد: "🔵", "قيد التنفيذ": "🟡", جاهز: "🟢", "تم التسليم": "⚪" })[s];

export const sDot = (s: Status): string =>
  ({ جديد: "bg-blue-400", "قيد التنفيذ": "bg-amber-400", جاهز: "bg-emerald-400", "تم التسليم": "bg-gray-300" })[s];
