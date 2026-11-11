# بناء APK محلي لتطبيق «خياطة وأقمشة العمر»

التطبيق React + Vite + Tailwind، ويُبنى إلى ملف واحد `dist/index.html` (بفضل `vite-plugin-singlefile`)، وكل البيانات تُحفظ في `localStorage` على الجهاز نفسه. لا يوجد أي سيرفر أو حساب مطلوب.

## قبل البدء: ما هو متوفر على هذا الجهاز

| المتطلب | الحالة |
|---|---|
| Node.js 20+ | ✅ Node 24 |
| Java JDK 17 أو أحدث | ❌ الموجود Java 1.8 فقط — لازم ترقية |
| Android SDK + Build Tools | ❌ غير مثبت |

> Capacitor وGradle لا يعملان مع Java 8. أسهل طريقة: ثبّت Android Studio (يأتي معه JDK 17 داخل `Android Studio/jbr`) واستخدمه كـ `JAVA_HOME`.

---

## الخيار أ — تثبيت PWA (الأسرع، وإشعارات المتصفح تعمل)

لا يحتاج Android SDK ولا APK:

1. `npm run build` ثم انشر محتوى `dist` مرة واحدة على أي استضافة HTTPS مجانية (Netlify Drop، GitHub Pages، Vercel...).
2. افتح الرابط من Chrome على الهاتف ← القائمة ← **تثبيت التطبيق / إضافة إلى الشاشة الرئيسية**.
3. من داخل التطبيق: **تفعيل التنبيهات** ← اسمح بالإشعارات.

بعد التثبيت يعمل التطبيق بدون إنترنت، والبيانات تبقى على الهاتف. الإشعارات تصل والتطبيق مفتوح أو في الخلفية، ومتى أُغلق التطبيق تماماً تتوقف (لا Push خارجي).

---

## الخيار ب — APK حقيقي عبر Capacitor (يعمل بدون إنترنت وبدون استضافة)

### 1) تجهيز البيئة

1. ثبّت [Android Studio](https://developer.android.com/studio).
2. في PowerShell مرة واحدة (المسارات حسب جهازك):

```powershell
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

3. أغلق الطرفية وافتحها من جديد، وتأكد:

```bash
java -version   # يجب أن يظهر 17 أو أحدث
```

### 2) إضافة Capacitor للمشروع

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "خياطة العمر" "com.omr.tailor" --web-dir dist
```

يُنشأ ملف `capacitor.config.ts`، تأكد أن بدايته هكذا:

```ts
const config: CapacitorConfig = {
  appId: "com.omr.tailor",
  appName: "خياطة العمر",
  webDir: "dist",
};
```

### 3) بناء التطبيق وإضافة منصة أندرويد

```bash
npm run build
npx cap add android
npx cap sync android
```

### 4) توليد APK

```bash
cd android
./gradlew assembleDebug
```

الملف الناتج:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

### 5) تثبيته على الهاتف

- انسخ `app-debug.apk` إلى الهاتف وثبّته (اسمح بـ«تثبيت من مصادر غير معروفة»)، أو
- وصّل الهاتف بكابل USB مع تفعيل USB Debugging ثم:

```bash
adb install -r app-debug.apk
```

### 6) نسخة موقّعة (اختياري، للتوزيع أو التحديث السلس)

```bash
keytool -genkey -v -keystore tailor.keystore -alias tailor -keyalg RSA -keysize 2048 -validity 10000
```

ثم أضف التوقيع في `android/app/build.gradle` (قسم `signingConfigs`)، وابنِ بـ:

```bash
./gradlew assembleRelease
```

> عند تحديث التطبيق لاحقاً استخدم **نفس** الـ keystore، وإلا سيرفض أندرويد التحديث فوق النسخة القديمة.

### تحديث التطبيق بعد تعديل الكود

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

البيانات لا تُفقد عند التحديث لأن تخزين WebView يبقى، لكن خُذ نسخة احتياطية من داخل التطبيق (📥 تحميل نسخة) قبل أي تجربة كبيرة.

---

## ⚠️ مهم جداً: الإشعارات داخل الـ APK

WebView الخاص بـ Capacitor **لا يدعم** واجهة `Notification` ولا Service Worker، أي أن تنبيهات الجهاز الحالية (المبنية على إشعارات المتصفح) لن تظهر داخل الـ APK. مركز التنبيهات داخل التطبيق سيبقى يعمل، لكن إشعارات النظام تحتاج إضافة:

```bash
npm install @capacitor/local-notifications
npx cap sync android
```

ثم استبدال استدعاء إشعار المتصفح في `showLocalNotification` (داخل `src/App.tsx`) بنداء البلجن:

```ts
import { LocalNotifications } from "@capacitor/local-notifications";

await LocalNotifications.requestPermissions();
await LocalNotifications.schedule({
  notifications: [
    {
      id: Date.now() % 2147483647,
      title,
      body,
      schedule: { at: new Date() },
      extra: { url: orderId ? `/?page=archive&orderId=${orderId}` : "/?page=home" },
    },
  ],
});
```

كما يلزم جدولة التذكيرات في الخلفية (Background Runner أو AlarmManager) بدل الاعتماد على مؤقت الواجهة، لأن أندرويد يوقف مؤقتات WebView عند إغلاق التطبيق.

**الخلاصة العملية:** لجهاز واحد مع إشعارات تعمل اليوم بلا تعديل كود، الخيار (أ) هو الأنسب. أما الـ APK فيحتاج خطوة إضافية لربط `@capacitor/local-notifications` — أطلب مني تنفيذها عند الحاجة.
