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
export const today = () => nowISO().slice(0, 10);
export const addD = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};
export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** يحوّل أي قيمة قادمة من نموذج أو ملف نسخة احتياطية إلى رقم آمن. */
export const toNum = (v: unknown) => {
  const r = Number(String(v ?? "").replace(/[^\d.]/g, ""));
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

/** يرمّم أي طلب (من التخزين المحلي أو نسخة احتياطية) إلى شكل صالح دائماً. */
export const fixOrder = (r: Partial<Order>): Order => {
  const b = blank();
  const ms = SECS.reduce<Meas>((a, s) => {
    const raw = r.m?.[s.key];
    a[s.key] = s.fields.reduce<Record<string, string>>((acc, f) => {
      acc[f.id] = asText(raw?.[f.id]);
      return acc;
    }, {});
    return a;
  }, {});

  return {
    ...b,
    ...r,
    id: asText(r.id) || b.id,
    name: asText(r.name),
    phone: asText(r.phone),
    total: asText(r.total),
    paid: asText(r.paid),
    date: asText(r.date) || b.date,
    delivery: asText(r.delivery) || b.delivery,
    fabric: asText(r.fabric),
    pieces: asText(r.pieces, "1") || "1",
    status: ALL.includes(r.status as Status) ? (r.status as Status) : "جديد",
    notes: asText(r.notes),
    m: ms,
    created: asText(r.created) || b.created,
    updated: asText(r.updated) || b.updated,
  };
};

export const sortOrders = (l: Order[]) => [...l].sort((a, b) => b.updated.localeCompare(a.updated));

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
