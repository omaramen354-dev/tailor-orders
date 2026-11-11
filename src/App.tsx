import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL,
  DB,
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTINGS_KEY,
  NOTIFIED_EVENTS_KEY,
  SECS,
  STORE,
  blank,
  fixOrder,
  fmtDate,
  money,
  nowISO,
  sColor,
  sDot,
  sIcon,
  sortOrders,
  toNum,
  today,
  type NotificationSettings,
  type Order,
  type Page,
  type Status,
} from "./lib/orders";
import {
  alertLabel,
  alertTone,
  buildAlertFeed,
  getPendingAlerts,
  mergeNotifiedKeys,
  planReminderNotifications,
  type AlertItem,
} from "./lib/notifications";

/* ══════════════════════ MAIN APP ══════════════════════ */
export default function App() {
  const supportsNotifications = typeof window !== "undefined" && "Notification" in window;

  /* ── state ── */
  const [pg, setPg] = useState<Page>("home");
  const [orders, setOrders] = useState<Order[]>(() => {
    try {
      const s = localStorage.getItem(DB);
      if (!s) return [];
      const p = JSON.parse(s);
      return Array.isArray(p) ? sortOrders(p.map((x: Partial<Order>) => fixOrder(x))) : [];
    } catch {
      return [];
    }
  });
  const [form, setForm] = useState<Order>(blank);
  const [q, setQ] = useState("");
  const [fStatus, setFS] = useState("الكل");
  const [toast, setToast] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [installPrompt, setIP] = useState<BeforeInstallPromptEvent | null>(null);
  const [isOnline, setOnline] = useState(navigator.onLine);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    supportsNotifications ? Notification.permission : "denied",
  );
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() => {
    try {
      const raw = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
      return raw ? { ...DEFAULT_NOTIFICATION_SETTINGS, ...(JSON.parse(raw) as Partial<NotificationSettings>) } : DEFAULT_NOTIFICATION_SETTINGS;
    } catch {
      return DEFAULT_NOTIFICATION_SETTINGS;
    }
  });
  const [notifiedEvents, setNotifiedEvents] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(NOTIFIED_EVENTS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const [dayKey, setDayKey] = useState(today);
  const importRef = useRef<HTMLInputElement>(null);

  /* ── effects ── */
  useEffect(() => {
    localStorage.setItem(DB, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(notificationSettings));
  }, [notificationSettings]);

  useEffect(() => {
    localStorage.setItem(NOTIFIED_EVENTS_KEY, JSON.stringify(notifiedEvents.slice(-500)));
  }, [notifiedEvents]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const id = window.setInterval(() => setDayKey(today()), 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setIP(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    const syncPermission = () => {
      if (supportsNotifications) {
        setNotificationPermission(Notification.permission);
      }
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        syncPermission();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", syncPermission);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", syncPermission);
    };
  }, [supportsNotifications]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page");
    const orderId = params.get("orderId");

    if (page === "archive") setPg("archive");
    if (page === "home") setPg("home");
    if (orderId) setExpanded(orderId);
  }, []);

  /* ── computed ── */
  const bal = useMemo(() => toNum(form.total) - toNum(form.paid), [form.total, form.paid]);

  const filtered = useMemo(() => {
    let list = sortOrders(orders);
    if (fStatus !== "الكل") list = list.filter((o) => o.status === fStatus);
    const query = q.trim().toLowerCase();
    if (query) {
      list = list.filter((o) => [o.name, o.phone, o.fabric, o.notes, o.status].join(" ").toLowerCase().includes(query));
    }
    return list;
  }, [orders, q, fStatus]);

  const stats = useMemo(
    () => ({
      total: orders.length,
      due: orders.reduce((s, o) => s + Math.max(toNum(o.total) - toNum(o.paid), 0), 0),
      ready: orders.filter((o) => o.status === "جاهز").length,
      inProg: orders.filter((o) => o.status === "قيد التنفيذ").length,
      done: orders.filter((o) => o.status === "تم التسليم").length,
      newO: orders.filter((o) => o.status === "جديد").length,
      todayDel: orders.filter((o) => o.delivery === dayKey).length,
    }),
    [orders, dayKey],
  );

  const recentOrders = useMemo(() => sortOrders(orders).slice(0, 5), [orders]);
  const alertFeed = useMemo(
    () => buildAlertFeed(orders, notificationSettings, dayKey),
    [orders, notificationSettings, dayKey],
  );
  const notifiedSet = useMemo(() => new Set(notifiedEvents), [notifiedEvents]);
  const unseenAlertCount = useMemo(() => alertFeed.filter((alert) => !notifiedSet.has(alert.key)).length, [alertFeed, notifiedSet]);

  /* ── actions ── */
  const setF = useCallback(<K extends keyof Order>(k: K, v: Order[K]) => {
    setForm((f) => ({ ...f, [k]: v, updated: nowISO() }));
  }, []);

  const setM = useCallback((sec: string, fid: string, v: string) => {
    setForm((f) => ({
      ...f,
      m: { ...f.m, [sec]: { ...f.m[sec], [fid]: v } },
      updated: nowISO(),
    }));
  }, []);

  const msg = (t: string) => setToast(t);

  const openAlertOrder = useCallback(
    (alert: AlertItem) => {
      setExpanded(alert.orderId);
      setFS("الكل");
      setPg("archive");
    },
    [],
  );

  const showLocalNotification = useCallback(
    async (title: string, body: string, tag: string, orderId?: string) => {
      if (!supportsNotifications || Notification.permission !== "granted") {
        return false;
      }

      const options: NotificationOptions = {
        body,
        icon: "/icon-512.png",
        badge: "/icon-512.png",
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
    },
    [supportsNotifications],
  );

  const checkAndSendReminders = useCallback(async () => {
    if (!notificationSettings.enabled || notificationPermission !== "granted") return;

    const pending = getPendingAlerts(alertFeed, notifiedSet);
    if (!pending.length) return;

    const plan = planReminderNotifications(pending, STORE.name);
    const sentKeys: string[] = [];

    for (const alert of plan.individual) {
      const ok = await showLocalNotification(alert.title, alert.body, alert.key, alert.orderId);
      if (ok) sentKeys.push(alert.key);
    }

    if (plan.summary) {
      const summaryOk = await showLocalNotification(
        plan.summary.title,
        plan.summary.body,
        `summary:${dayKey}`,
      );
      if (summaryOk) sentKeys.push(...plan.summary.keys);
    }

    if (sentKeys.length) {
      setNotifiedEvents((prev) => mergeNotifiedKeys(prev, sentKeys));
    }
  }, [alertFeed, dayKey, notificationPermission, notificationSettings.enabled, notifiedSet, showLocalNotification]);

  useEffect(() => {
    void checkAndSendReminders();
    const intervalId = window.setInterval(() => {
      void checkAndSendReminders();
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkAndSendReminders]);

  const requestNotificationPermission = async (): Promise<NotificationPermission> => {
    if (!supportsNotifications) {
      msg("❌ الإشعارات غير مدعومة على هذا الجهاز");
      return "denied";
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === "granted") {
        setNotificationSettings((prev) => ({ ...prev, enabled: true }));
        msg("🔔 تم تفعيل الإشعارات");
      } else if (permission === "denied") {
        msg("❌ تم رفض الإشعارات من المتصفح");
      } else {
        msg("ℹ️ لم يتم تفعيل الإشعارات بعد");
      }

      return permission;
    } catch {
      msg("❌ تعذر طلب إذن الإشعارات");
      return "denied";
    }
  };

  const toggleNotificationSystem = async () => {
    if (!supportsNotifications) {
      msg("❌ الإشعارات غير مدعومة");
      return;
    }

    if (notificationPermission !== "granted") {
      await requestNotificationPermission();
      return;
    }

    setNotificationSettings((prev) => ({ ...prev, enabled: !prev.enabled }));
    msg(notificationSettings.enabled ? "🔕 تم إيقاف التنبيهات" : "🔔 تم تشغيل التنبيهات");
  };

  const sendTestNotification = async () => {
    if (!supportsNotifications) {
      msg("❌ الإشعارات غير مدعومة");
      return;
    }

    let permission = notificationPermission;
    if (permission !== "granted") {
      permission = await requestNotificationPermission();
    }

    if (permission !== "granted") {
      msg("❌ يلزم السماح بالإشعارات أولاً");
      return;
    }

    const ok = await showLocalNotification(
      "تنبيه تجريبي",
      "تم تشغيل نظام التنبيهات بنجاح في تطبيق خياطة وأقمشة العمر.",
      `test:${Date.now()}`,
    );

    msg(ok ? "✅ تم إرسال تنبيه تجريبي" : "❌ تعذر إرسال التنبيه");
  };

  const updateNotificationSetting = (key: keyof NotificationSettings, value: boolean) => {
    setNotificationSettings((prev) => ({ ...prev, [key]: value }));
    msg("⚙️ تم تحديث إعدادات التنبيه");
  };

  const save = () => {
    if (!form.name.trim()) {
      msg("⚠️ أدخل اسم العميل أولاً");
      return;
    }

    const o = { ...form, updated: nowISO() };
    setOrders((prev) => {
      const exists = prev.some((x) => x.id === o.id);
      return sortOrders(exists ? prev.map((x) => (x.id === o.id ? o : x)) : [o, ...prev]);
    });
    setForm(o);
    setPg("archive");
    msg("✅ تم حفظ الطلب");
  };

  const load = (o: Order) => {
    setForm(fixOrder(o));
    setPg("form");
    msg("📋 تم فتح الطلب");
  };

  const del = (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o || !confirm(`حذف طلب ${o.name}؟`)) return;
    setOrders((prev) => prev.filter((x) => x.id !== id));
    if (form.id === id) setForm(blank());
    msg("🗑️ تم الحذف");
  };

  const newOrder = () => {
    setForm(blank());
    setPg("form");
  };

  const share = async () => {
    if (!form.name.trim()) {
      msg("⚠️ أدخل الاسم أولاً");
      return;
    }

    const t = toNum(form.total);
    const p = toNum(form.paid);
    const txt = [
      `✂️ ${STORE.name}`,
      `👤 ${form.name}`,
      `📱 ${form.phone || "—"}`,
      `📌 ${form.status}`,
      `💰 القيمة: ${money(t)}`,
      `✅ المدفوع: ${money(p)}`,
      `⏳ المتبقي: ${money(t - p)}`,
      `📅 ${fmtDate(form.date)}`,
      `📦 الاستلام: ${fmtDate(form.delivery)}`,
    ].join("\n");

    try {
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (nav && typeof nav.share === "function") {
        await nav.share({ title: STORE.name, text: txt });
        return;
      }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(txt);
        msg("📋 تم النسخ");
        return;
      }
      msg("المشاركة غير متاحة");
    } catch {
      msg("تعذرت المشاركة");
    }
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(orders, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `خياطة-العمر-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    msg("📥 تم تحميل النسخة الاحتياطية");
  };

  const importBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(data)) {
          msg("❌ ملف غير صالح");
          return;
        }
        const imported = data.map((x: Partial<Order>) => fixOrder(x));
        setOrders((prev) => {
          const ids = new Set(prev.map((o) => o.id));
          return sortOrders([...prev, ...imported.filter((o: Order) => !ids.has(o.id))]);
        });
        msg(`✅ تم استيراد ${imported.length} طلب`);
      } catch {
        msg("❌ خطأ في قراءة الملف");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setIP(null);
    msg("🎉 جاري التثبيت");
  };

  /* ══════════════════════ RENDER ══════════════════════ */
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 pb-24 text-slate-900 select-none">
      {toast ? (
        <div className="no-print fixed left-3 right-3 top-3 z-[99] mx-auto max-w-sm">
          <div className="anim-toast rounded-2xl bg-slate-900 px-5 py-3.5 text-center text-sm font-semibold text-white shadow-2xl">
            {toast}
          </div>
        </div>
      ) : null}

      {/* ══════ HOME ══════ */}
      {pg === "home" ? (
        <div className="anim-fade">
          <div className="relative overflow-hidden bg-slate-900 px-5 pb-16 pt-10">
            <div className="absolute -left-10 -top-10 h-52 w-52 rounded-full bg-white/[0.03]" />
            <div className="absolute left-28 top-6 h-24 w-24 rounded-full bg-white/[0.04]" />
            <div className="absolute -bottom-8 -right-6 h-40 w-40 rounded-full bg-white/[0.03]" />

            <div className="relative mx-auto max-w-xl">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className="text-[11px] text-slate-400">{isOnline ? "متصل بالإنترنت" : "بدون إنترنت"}</span>
                </div>
                {installPrompt ? (
                  <button onClick={installApp} className="rounded-xl bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white">
                    📲 ثبّت التطبيق
                  </button>
                ) : null}
              </div>

              <div className="mb-2 text-3xl">✂️</div>
              <h1 className="text-2xl font-black text-white leading-snug">{STORE.name}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-400">{STORE.desc}</p>
              <p className="mt-1 text-xs text-slate-500">📱 {STORE.tel} · إدارة: {STORE.mgr}</p>
              <p className="mt-5 text-sm text-slate-300">
                {new Date().getHours() < 12 ? "☀️ صباح الخير" : new Date().getHours() < 18 ? "🌤️ مساء الخير" : "🌙 مساء النور"}،
                أهلاً بك في نظام إدارة الطلبات
              </p>
            </div>
          </div>

          <div className="mx-auto -mt-8 max-w-xl space-y-4 px-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon="📋" label="إجمالي الطلبات" value={stats.total} sub="طلب محفوظ" color="bg-white" textColor="text-slate-800" />
              <StatCard icon="⏳" label="المبالغ المتبقية" value={money(stats.due)} sub="قيد التحصيل" color="bg-white" textColor="text-red-600" />
              <StatCard icon="🟢" label="جاهز للتسليم" value={stats.ready} sub="طلب جاهز" color="bg-emerald-50" textColor="text-emerald-700" badge={stats.ready > 0} />
              <StatCard icon="🟡" label="قيد التنفيذ" value={stats.inProg} sub="طلب" color="bg-amber-50" textColor="text-amber-700" />
            </div>

            {stats.todayDel > 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
                <span className="text-2xl">🔔</span>
                <div>
                  <p className="text-sm font-extrabold text-red-700">تنبيه: تسليم اليوم</p>
                  <p className="mt-0.5 text-xs text-red-500">{stats.todayDel} طلب موعد تسليمه اليوم</p>
                </div>
                <button onClick={() => { setFS("الكل"); setPg("archive"); }} className="mr-auto rounded-xl bg-red-100 px-3 py-2 text-xs font-bold text-red-600">
                  عرض
                </button>
              </div>
            ) : null}

            <div>
              <p className="mb-2.5 px-1 text-xs font-extrabold text-slate-500">الإجراءات السريعة</p>
              <div className="grid grid-cols-3 gap-2.5">
                <QuickBtn icon="✏️" label="طلب جديد" onClick={newOrder} primary />
                <QuickBtn icon="📚" label="السجل" onClick={() => setPg("archive")} />
                <QuickBtn icon="💾" label="نسخة احتياطية" onClick={exportBackup} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-extrabold text-slate-500">توزيع الطلبات</p>
                <span className="text-[10px] font-bold text-slate-400">{stats.total} إجمالي</span>
              </div>
              {stats.total === 0 ? (
                <p className="py-3 text-center text-xs text-slate-400">لا توجد طلبات بعد</p>
              ) : (
                <div className="space-y-2.5">
                  {ALL.map((s) => {
                    const count = orders.filter((o) => o.status === s).length;
                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                    return (
                      <div key={s} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 text-xs font-bold text-slate-600">{sIcon(s)} {s}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full transition-all ${sDot(s)}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-6 shrink-0 text-left text-xs font-extrabold text-slate-700">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold text-slate-800">🔔 نظام التنبيهات</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">
                    تنبيهات للطلبات المتأخرة أو المستحقة اليوم أو غداً أثناء تشغيل التطبيق، مع إشعارات الجهاز عند السماح بها.
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${notificationSettings.enabled && notificationPermission === "granted" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {notificationSettings.enabled && notificationPermission === "granted" ? "مفعّل" : "متوقف"}
                </span>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                <button onClick={toggleNotificationSystem} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800">
                  {notificationSettings.enabled && notificationPermission === "granted" ? "🔕 إيقاف التنبيهات" : "🔔 تفعيل التنبيهات"}
                </button>
                <button onClick={sendTestNotification} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                  🧪 اختبار تنبيه
                </button>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                <SettingChip label="طلبات اليوم" active={notificationSettings.today} onClick={() => updateNotificationSetting("today", !notificationSettings.today)} />
                <SettingChip label="طلبات الغد" active={notificationSettings.tomorrow} onClick={() => updateNotificationSetting("tomorrow", !notificationSettings.tomorrow)} />
                <SettingChip label="المتأخرات" active={notificationSettings.overdue} onClick={() => updateNotificationSetting("overdue", !notificationSettings.overdue)} />
              </div>

              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-extrabold text-slate-500">مركز التنبيهات</p>
                  <span className="text-[10px] font-bold text-slate-400">{alertFeed.length} تنبيه حالي · {unseenAlertCount} جديد</span>
                </div>

                {alertFeed.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">
                    لا توجد تنبيهات حالياً
                  </div>
                ) : (
                  <div className="space-y-2">
                    {alertFeed.slice(0, 4).map((alert) => (
                      <button
                        key={alert.key}
                        onClick={() => openAlertOrder(alert)}
                        className={`w-full rounded-xl border px-3 py-3 text-right transition hover:opacity-90 ${alertTone(alert.kind)}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-extrabold">{alert.customerName || "عميل بدون اسم"}</p>
                            <p className="mt-1 text-[11px] leading-5 opacity-90">{alert.body}</p>
                          </div>
                          <div className="shrink-0 text-left">
                            <span className="rounded-lg bg-white/70 px-2 py-1 text-[10px] font-bold">{alertLabel(alert.kind)}</span>
                            <p className="mt-2 text-[10px] font-bold">{fmtDate(alert.delivery)}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p className="mt-3 text-[10px] leading-5 text-slate-400">
                ملاحظة: هذه التنبيهات محلية داخل التطبيق. للتنبيهات الخلفية الكاملة حتى عند إغلاق التطبيق نهائياً نحتاج ربط لاحق بخدمة Push خارجية.
              </p>
            </div>

            <div>
              <div className="mb-2.5 flex items-center justify-between px-1">
                <p className="text-xs font-extrabold text-slate-500">آخر الطلبات</p>
                {orders.length > 0 ? (
                  <button onClick={() => setPg("archive")} className="text-xs font-bold text-blue-600">
                    عرض الكل ←
                  </button>
                ) : null}
              </div>

              {recentOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <p className="mb-2 text-3xl">📭</p>
                  <p className="text-sm font-semibold text-slate-500">لا توجد طلبات بعد</p>
                  <button onClick={newOrder} className="mt-4 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white">
                    ابدأ بإضافة طلب
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentOrders.map((o) => {
                    const ob = toNum(o.total) - toNum(o.paid);
                    return (
                      <button
                        key={o.id}
                        onClick={() => load(o)}
                        className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-right shadow-sm transition hover:border-slate-300 active:scale-[0.98]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="truncate text-sm font-extrabold text-slate-900">{o.name}</span>
                              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold ${sColor(o.status)}`}>{o.status}</span>
                            </div>
                            <p className="text-[11px] font-semibold text-slate-400">
                              {o.phone ? `📱 ${o.phone} · ` : ""}📦 استلام {fmtDate(o.delivery)}
                            </p>
                          </div>
                          <div className="shrink-0 text-left">
                            <p className={`text-sm font-black ${ob > 0 ? "text-red-600" : "text-emerald-600"}`}>{money(ob)}</p>
                            <p className="text-[10px] text-slate-400">متبقي</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pb-4 pt-2 text-center">
              <p className="text-[11px] text-slate-400">الحفظ تلقائي على جهازك ✓</p>
              <p className="mt-1 text-[10px] text-slate-300">بسم الله الرحمن الرحيم — وما توفيقي إلا بالله</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* ══════ FORM ══════ */}
      {pg === "form" ? (
        <div className="anim-fade">
          <div className="bg-slate-900 px-5 pb-5 pt-10">
            <div className="mx-auto flex max-w-xl items-center gap-3">
              <button onClick={() => setPg("home")} className="text-lg text-slate-400 transition hover:text-white">
                ←
              </button>
              <div>
                <h2 className="text-lg font-extrabold text-white">{form.name ? `تعديل · ${form.name}` : "طلب جديد"}</h2>
                <p className="mt-0.5 text-xs text-slate-400">أدخل بيانات العميل والقياسات</p>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
            <Card title="👤 بيانات العميل">
              <div className="space-y-3">
                <Inp label="الاسم" v={form.name} set={(v) => setF("name", v)} ph="اسم العميل الكامل" />
                <div className="grid grid-cols-2 gap-3">
                  <Inp label="رقم الهاتف" v={form.phone} set={(v) => setF("phone", v)} ph="09xxxxxxxx" type="tel" />
                  <Inp label="نوع القماش" v={form.fabric} set={(v) => setF("fabric", v)} ph="صوف / كتان" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Inp label="تاريخ الطلب" v={form.date} set={(v) => setF("date", v)} type="date" />
                  <Inp label="تاريخ الاستلام" v={form.delivery} set={(v) => setF("delivery", v)} type="date" />
                </div>
                <Inp label="عدد القطع" v={form.pieces} set={(v) => setF("pieces", v)} type="number" ph="1" />
                <div>
                  <p className="mb-2 text-xs font-bold text-slate-600">حالة الطلب</p>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL.map((s) => (
                      <button
                        key={s}
                        onClick={() => setF("status", s)}
                        className={`rounded-xl border py-2.5 text-xs font-bold transition ${
                          form.status === s
                            ? `${sColor(s)} border-transparent ring-2 ring-slate-200 ring-offset-1`
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {sIcon(s)} {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="💰 الحساب المالي">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Inp label="القيمة الكلية" v={form.total} set={(v) => setF("total", v)} type="number" ph="0" />
                <Inp label="المبلغ المدفوع" v={form.paid} set={(v) => setF("paid", v)} type="number" ph="0" />
              </div>
              <div className={`rounded-2xl border p-4 text-center ${bal > 0 ? "border-red-100 bg-red-50" : bal < 0 ? "border-amber-100 bg-amber-50" : "border-emerald-100 bg-emerald-50"}`}>
                <p className="text-xs font-semibold text-slate-500">المبلغ المتبقي</p>
                <p className={`mt-1 text-2xl font-black ${bal > 0 ? "text-red-600" : bal < 0 ? "text-amber-600" : "text-emerald-600"}`}>{money(bal)}</p>
              </div>
            </Card>

            {SECS.map((sec) => (
              <Card key={sec.key} title={`${sec.icon} ${sec.title}`}>
                <div className="grid grid-cols-3 gap-x-2.5 gap-y-3">
                  {sec.fields.map((f) => (
                    <div key={f.id}>
                      <label className="mb-1 block text-[11px] font-bold text-slate-500">{f.label}</label>
                      <input
                        value={form.m[sec.key]?.[f.id] ?? ""}
                        onChange={(e) => setM(sec.key, f.id, e.target.value)}
                        placeholder={f.ph}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            ))}

            <Card title="📝 ملاحظات">
              <textarea
                value={form.notes}
                onChange={(e) => setF("notes", e.target.value)}
                placeholder="أي تعليمات خاصة بالتفصيل..."
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </Card>

            <div className="no-print space-y-2.5">
              <button onClick={save} className="w-full rounded-2xl bg-slate-900 py-4 text-sm font-extrabold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 active:scale-[0.98]">
                💾 حفظ الطلب
              </button>
              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={() => setPg("preview")} className="rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                  👁️ معاينة
                </button>
                <button onClick={share} className="rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                  📤 مشاركة
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ══════ ARCHIVE ══════ */}
      {pg === "archive" ? (
        <div className="anim-fade">
          <div className="bg-slate-900 px-5 pb-5 pt-10">
            <div className="mx-auto flex max-w-xl items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={() => setPg("home")} className="text-lg text-slate-400 transition hover:text-white">
                  ←
                </button>
                <div>
                  <h2 className="text-lg font-extrabold text-white">سجل الطلبات</h2>
                  <p className="mt-0.5 text-xs text-slate-400">{orders.length} طلب · حفظ تلقائي ✓</p>
                </div>
              </div>
              <button onClick={newOrder} className="rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/20">
                + جديد
              </button>
            </div>
          </div>

          <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
            <div className="relative">
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث بالاسم، الهاتف، القماش..."
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>

            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {["الكل", ...ALL].map((s) => {
                const count = s === "الكل" ? orders.length : orders.filter((o) => o.status === s).length;
                return (
                  <button
                    key={s}
                    onClick={() => setFS(s)}
                    className={`whitespace-nowrap rounded-xl border px-3.5 py-2 text-[11px] font-bold transition ${
                      fStatus === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {s === "الكل" ? "📋" : sIcon(s as Status)} {s} ({count})
                  </button>
                );
              })}
            </div>

            <p className="px-1 text-[11px] font-semibold text-slate-400">{filtered.length} نتيجة</p>

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="mb-3 text-4xl">📭</p>
                <p className="text-sm font-semibold text-slate-500">لا توجد طلبات</p>
              </div>
            ) : (
              filtered.map((o) => {
                const ob = toNum(o.total) - toNum(o.paid);
                const isOpen = expanded === o.id;

                return (
                  <div key={o.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button onClick={() => setExpanded(isOpen ? null : o.id)} className="w-full p-4 text-right transition hover:bg-slate-50/50 active:bg-slate-100">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="truncate text-[15px] font-extrabold text-slate-900">{o.name || "بدون اسم"}</span>
                            <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${sColor(o.status)}`}>{o.status}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-slate-400">
                            {o.phone ? <span>📱 {o.phone}</span> : null}
                            <span>📅 {fmtDate(o.date)}</span>
                            {o.fabric ? <span>🧵 {o.fabric}</span> : null}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          <p className={`text-[15px] font-black ${ob > 0 ? "text-red-600" : "text-emerald-600"}`}>{money(ob)}</p>
                          <p className="text-[10px] text-slate-400">متبقي</p>
                        </div>
                      </div>
                    </button>

                    {isOpen ? (
                      <div className="anim-slide border-t border-slate-100 px-4 pb-4">
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <MiniStat label="القيمة" value={money(toNum(o.total))} />
                          <MiniStat label="المدفوع" value={money(toNum(o.paid))} color="text-emerald-600" />
                          <MiniStat label="المتبقي" value={money(ob)} color={ob > 0 ? "text-red-600" : "text-emerald-600"} bg={ob > 0 ? "bg-red-50" : "bg-emerald-50"} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <MiniStat label="التاريخ" value={fmtDate(o.date)} />
                          <MiniStat label="الاستلام" value={fmtDate(o.delivery)} />
                        </div>

                        {SECS.map((sec) => {
                          const vals = Object.entries(o.m[sec.key] || {}).filter(([, v]) => v);
                          if (!vals.length) return null;
                          return (
                            <div key={sec.key} className="mt-3">
                              <p className="mb-1.5 text-[11px] font-bold text-slate-500">{sec.icon} {sec.title}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {vals.map(([k, v]) => (
                                  <span key={k} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                                    {sec.fields.find((f) => f.id === k)?.label || k}: <span className="text-slate-900">{v}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}

                        {o.notes ? (
                          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
                            <p className="mb-1 text-[11px] font-bold text-amber-700">📝 ملاحظات</p>
                            <p className="whitespace-pre-wrap text-xs leading-5 text-amber-800">{o.notes}</p>
                          </div>
                        ) : null}

                        <div className="mt-4 flex gap-2">
                          <button onClick={() => load(o)} className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 active:scale-[0.97]">
                            ✏️ تعديل
                          </button>
                          <button onClick={() => { setForm(fixOrder(o)); setPg("preview"); }} className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold transition hover:bg-slate-50">
                            👁️ معاينة
                          </button>
                          <button onClick={() => del(o.id)} className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-xs font-bold text-red-500 transition hover:bg-red-50">
                            🗑️
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}

            <div className="mt-2 space-y-2 border-t border-slate-200 pt-4">
              <p className="px-1 text-xs font-extrabold text-slate-500">💾 النسخ الاحتياطي</p>
              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={exportBackup} className="rounded-2xl border border-slate-200 bg-white py-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                  📥 تحميل نسخة
                </button>
                <button onClick={() => importRef.current?.click()} className="rounded-2xl border border-slate-200 bg-white py-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                  📤 استيراد نسخة
                </button>
              </div>
              <input ref={importRef} type="file" accept=".json" onChange={importBackup} className="hidden" />
            </div>
          </div>
        </div>
      ) : null}

      {/* ══════ PREVIEW ══════ */}
      {pg === "preview" ? (
        <div className="anim-fade">
          <div className="no-print bg-slate-900 px-5 pb-5 pt-10">
            <div className="mx-auto flex max-w-xl items-center gap-3">
              <button onClick={() => setPg("form")} className="text-lg text-slate-400 transition hover:text-white">
                ←
              </button>
              <h2 className="text-lg font-extrabold text-white">معاينة البطاقة</h2>
            </div>
          </div>

          <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
            <div className="no-print grid grid-cols-2 gap-2.5">
              <button onClick={() => { setTimeout(() => window.print(), 100); }} className="rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-800">
                🖨️ طباعة
              </button>
              <button onClick={share} className="rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold transition hover:bg-slate-50">
                📤 مشاركة
              </button>
            </div>

            <div className="print-area rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 border-b-2 border-slate-800 pb-4 text-center">
                <p className="text-[11px] text-slate-500">بسم الله الرحمن الرحيم</p>
                <h2 className="mt-1.5 text-2xl font-black text-slate-900">{STORE.name}</h2>
                <p className="mt-1 text-xs font-semibold text-slate-600">{STORE.desc}</p>
                <p className="mt-1 text-xs text-slate-500">إدارة: {STORE.mgr} · {STORE.tel}</p>
              </div>

              <div className="mb-5 overflow-hidden rounded-xl border border-slate-300">
                {[
                  { l: "الاسم", v: form.name || "—" },
                  { l: "الهاتف", v: form.phone || "—" },
                  { l: "القماش", v: form.fabric || "—" },
                  { l: "القطع", v: form.pieces || "1" },
                  { l: "القيمة", v: money(toNum(form.total)) },
                  { l: "المدفوع", v: money(toNum(form.paid)) },
                  { l: "المتبقي", v: money(bal) },
                  { l: "التاريخ", v: fmtDate(form.date) },
                  { l: "الاستلام", v: fmtDate(form.delivery) },
                ].map((r, i) => (
                  <div key={r.l} className={`grid grid-cols-[6rem_1fr] text-sm ${i > 0 ? "border-t border-slate-200" : ""}`}>
                    <div className="border-l border-slate-200 bg-slate-50 px-3 py-2.5 font-extrabold text-slate-800">{r.l}</div>
                    <div className="px-3 py-2.5 font-semibold text-slate-700">{r.v}</div>
                  </div>
                ))}
              </div>

              {SECS.map((sec) => (
                <div key={sec.key} className="mb-4">
                  <p className="mb-2 text-sm font-extrabold text-slate-800">{sec.icon} {sec.title}</p>
                  <div className="overflow-hidden rounded-xl border border-slate-300">
                    <table className="w-full text-center text-sm">
                      <thead>
                        <tr className="bg-slate-50">
                          {sec.fields.map((f) => (
                            <th key={f.id} className="whitespace-nowrap border-b border-slate-300 px-2 py-2.5 text-[11px] font-bold text-slate-700">
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {sec.fields.map((f) => (
                            <td key={f.id} className="whitespace-nowrap px-2 py-3 font-semibold text-slate-800">
                              {form.m[sec.key]?.[f.id] || "—"}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              <div className="overflow-hidden rounded-xl border border-slate-300">
                <div className="border-b border-slate-300 bg-slate-50 px-3 py-2.5">
                  <p className="text-sm font-extrabold text-slate-800">📝 ملاحظات</p>
                </div>
                <div className="min-h-16 whitespace-pre-wrap px-3 py-3 text-sm leading-6 text-slate-700">{form.notes || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ══════ BOTTOM NAV ══════ */}
      <nav className="no-print fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {([
            { k: "home" as Page, ic: "🏠", lb: "الرئيسية" },
            { k: "form" as Page, ic: "✏️", lb: "بطاقة" },
            { k: "archive" as Page, ic: "📚", lb: "السجل" },
            { k: "preview" as Page, ic: "👁️", lb: "معاينة" },
          ]).map((t) => (
            <button
              key={t.k}
              onClick={() => (t.k === "form" ? newOrder() : setPg(t.k))}
              className={`py-3 text-center transition active:scale-95 ${pg === t.k ? "text-slate-900" : "text-slate-400 hover:text-slate-600"}`}
            >
              <span className="block text-xl">{t.ic}</span>
              <span className={`mt-0.5 block text-[10px] ${pg === t.k ? "font-extrabold" : "font-semibold"}`}>{t.lb}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ══════════════════════ COMPONENTS ══════════════════════ */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
        <h3 className="text-sm font-extrabold text-slate-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Inp({ label, v, set, ph, type = "text" }: { label: string; v: string; set: (v: string) => void; ph?: string; type?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      <input
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      />
    </div>
  );
}

function MiniStat({ label, value, color = "text-slate-800", bg = "bg-slate-50" }: { label: string; value: string; color?: string; bg?: string }) {
  return (
    <div className={`${bg} rounded-xl p-2.5 text-center`}>
      <p className="text-[10px] font-semibold text-slate-400">{label}</p>
      <p className={`mt-1 text-xs font-extrabold ${color}`}>{value}</p>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color, textColor, badge }: { icon: string; label: string; value: string | number; sub: string; color: string; textColor: string; badge?: boolean }) {
  return (
    <div className={`${color} relative overflow-hidden rounded-2xl border border-slate-100 p-4 shadow-sm`}>
      {badge ? <span className="absolute left-2 top-2 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" /> : null}
      <span className="text-xl">{icon}</span>
      <p className={`mt-2 text-lg font-black leading-tight ${textColor}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-bold text-slate-500">{label}</p>
      <p className="text-[10px] text-slate-400">{sub}</p>
    </div>
  );
}

function QuickBtn({ icon, label, onClick, primary }: { icon: string; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border py-4 text-xs font-bold transition active:scale-95 ${
        primary ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-200" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span className="text-xl">{icon}</span>
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

function SettingChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-[11px] font-bold transition ${active ? "bg-slate-900 text-white" : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"}`}
    >
      {active ? "✓" : "○"} {label}
    </button>
  );
}

/* PWA */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
