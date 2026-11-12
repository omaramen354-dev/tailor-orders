package com.omr.tailor;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_HOST = "app.tailor.local";
    private static final String APP_START_URL = "https://" + APP_HOST + "/index.html";
    private static final String CHANNEL_ID = "tailor_reminders";
    private static final String EXTRA_ORDER_ID = "order_id";
    private static final String PERM_POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";

    private static final int REQ_OPEN_FILE = 1001;
    private static final int REQ_SAVE_BACKUP = 1002;
    private static final int REQ_POST_NOTIFICATIONS = 1003;

    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private String pendingBackupContent;
    private String pendingOrderId;
    private boolean pageLoaded = false;

    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (window != null) {
            window.setStatusBarColor(0xFF0F172A);
            window.setNavigationBarColor(0xFFFFFFFF);
            if (Build.VERSION.SDK_INT >= 26) {
                View decor = window.getDecorView();
                decor.setSystemUiVisibility(decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            }
        }

        ensureNotificationChannel();
        captureOrderFromIntent(getIntent());

        FrameLayout root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        root.setBackgroundColor(0xFF0F172A);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF8FAFC);
        configureWebView(webView);

        root.addView(
            webView,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        setContentView(root);

        webView.loadUrl(APP_START_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureOrderFromIntent(intent);
        dispatchPendingOrderIfReady();
    }

    private void captureOrderFromIntent(Intent intent) {
        if (intent == null) return;
        String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
        if (orderId != null && !orderId.isEmpty()) {
            pendingOrderId = orderId;
        }
    }

    private void dispatchPendingOrderIfReady() {
        if (!pageLoaded || webView == null || pendingOrderId == null) return;
        final String orderId = pendingOrderId;
        pendingOrderId = null;
        runJs("window.__openOrderFromNotification && window.__openOrderFromNotification(" + jsQuote(orderId) + ");");
    }

    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);

        view.addJavascriptInterface(new AndroidBridge(), "AndroidApp");

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                Uri uri = request != null ? request.getUrl() : null;
                if (uri != null && APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    String path = uri.getPath();
                    if (path == null || path.isEmpty() || "/".equals(path)) {
                        path = "/index.html";
                    }
                    String assetName = path.startsWith("/") ? path.substring(1) : path;
                    try {
                        InputStream stream = getAssets().open(assetName);
                        String mime = guessMimeType(assetName);
                        WebResourceResponse response = new WebResourceResponse(mime, "UTF-8", stream);
                        Map<String, String> headers = new HashMap<String, String>();
                        headers.put("Cache-Control", "no-store");
                        response.setResponseHeaders(headers);
                        return response;
                    } catch (IOException e) {
                        byte[] body = "Not Found".getBytes(StandardCharsets.UTF_8);
                        return new WebResourceResponse(
                            "text/plain",
                            "UTF-8",
                            404,
                            "Not Found",
                            new HashMap<String, String>(),
                            new ByteArrayInputStream(body)
                        );
                    }
                }
                return super.shouldInterceptRequest(v, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                Uri uri = request != null ? request.getUrl() : null;
                if (uri == null) return false;
                if (APP_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                try {
                    Intent external = new Intent(Intent.ACTION_VIEW, uri);
                    startActivity(external);
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                super.onPageFinished(v, url);
                pageLoaded = true;
                dispatchPendingOrderIfReady();
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, REQ_OPEN_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileUploadCallback = null;
                    return false;
                }
            }

            @Override
            public boolean onJsAlert(WebView v, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.confirm();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) {
                            result.cancel();
                        }
                    })
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.confirm();
                        }
                    })
                    .setNegativeButton(android.R.string.cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface d, int w) {
                            result.cancel();
                        }
                    })
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface d) {
                            result.cancel();
                        }
                    })
                    .show();
                return true;
            }
        });
    }

    private String guessMimeType(String assetName) {
        String lower = assetName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "تنبيهات طلبات الخياطة",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("تذكيرات مواعيد تسليم طلبات الخياطة");
                channel.enableVibration(true);
                nm.createNotificationChannel(channel);
            }
        }
    }

    private String checkNotificationPermissionState() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return "denied";
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(PERM_POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                return nm.areNotificationsEnabled() ? "granted" : "denied";
            }
            return "default";
        }
        return nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_POST_NOTIFICATIONS) {
            boolean granted = grantResults != null
                && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            String status = granted ? "granted" : "denied";
            runJs("window.__onNativeNotificationPermissionResult && window.__onNativeNotificationPermissionResult(" + jsQuote(status) + ");");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_OPEN_FILE) {
            ValueCallback<Uri[]> cb = fileUploadCallback;
            fileUploadCallback = null;
            if (cb != null) {
                Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
                cb.onReceiveValue(uri != null ? new Uri[]{uri} : null);
            }
            return;
        }

        if (requestCode == REQ_SAVE_BACKUP) {
            String content = pendingBackupContent;
            pendingBackupContent = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && content != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out != null) {
                        out.write(content.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        showWebToast("📥 تم حفظ النسخة الاحتياطية بنجاح");
                        return;
                    }
                } catch (IOException ignored) {
                }
                showWebToast("❌ تعذر حفظ ملف النسخة الاحتياطية");
            }
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){ return window.__handleAndroidBack ? Boolean(window.__handleAndroidBack()) : false; })()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (!"true".equals(value)) {
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            finish();
                        }
                    }
                }
            }
        );
    }

    @Override
    protected void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void showWebToast(String message) {
        runJs("window.__onNativeToast && window.__onNativeToast(" + jsQuote(message) + ");");
    }

    private void runJs(final String script) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(script, null);
                }
            }
        });
    }

    private static String jsQuote(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: sb.append(c); break;
            }
        }
        sb.append('"');
        return sb.toString();
    }

    public final class AndroidBridge {
        @JavascriptInterface
        public String getNotificationPermission() {
            return checkNotificationPermissionState();
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= 33) {
                        if (checkSelfPermission(PERM_POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                            String st = checkNotificationPermissionState();
                            runJs("window.__onNativeNotificationPermissionResult && window.__onNativeNotificationPermissionResult(" + jsQuote(st) + ");");
                        } else {
                            requestPermissions(new String[]{PERM_POST_NOTIFICATIONS}, REQ_POST_NOTIFICATIONS);
                        }
                    } else {
                        String st = checkNotificationPermissionState();
                        runJs("window.__onNativeNotificationPermissionResult && window.__onNativeNotificationPermissionResult(" + jsQuote(st) + ");");
                    }
                }
            });
        }

        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public boolean showNotification(String title, String body, String tag, String orderId) {
            if (!"granted".equals(checkNotificationPermissionState())) {
                return false;
            }
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;

            ensureNotificationChannel();

            Intent openIntent = new Intent(MainActivity.this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            if (orderId != null && !orderId.isEmpty()) {
                openIntent.putExtra(EXTRA_ORDER_ID, orderId);
            }

            int notifId = (tag != null && !tag.isEmpty()) ? tag.hashCode() : (int) (System.currentTimeMillis() & 0x7FFFFFFF);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(MainActivity.this, notifId, openIntent, flags);

            Notification.Builder builder = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(MainActivity.this, CHANNEL_ID)
                : new Notification.Builder(MainActivity.this);

            builder
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(title != null ? title : "خياطة العمر")
                .setContentText(body != null ? body : "")
                .setStyle(new Notification.BigTextStyle().bigText(body != null ? body : ""))
                .setAutoCancel(true)
                .setContentIntent(pi);

            nm.notify(notifId, builder.build());
            return true;
        }

        @JavascriptInterface
        public boolean saveBackup(final String filename, final String jsonContent) {
            if (jsonContent == null) return false;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingBackupContent = jsonContent;
                    String safeName = (filename != null && !filename.isEmpty()) ? filename : "tailor-backup.json";
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, safeName);
                    try {
                        startActivityForResult(intent, REQ_SAVE_BACKUP);
                    } catch (ActivityNotFoundException e) {
                        pendingBackupContent = null;
                        Intent fallback = new Intent(Intent.ACTION_SEND);
                        fallback.setType("text/plain");
                        fallback.putExtra(Intent.EXTRA_SUBJECT, safeName);
                        fallback.putExtra(Intent.EXTRA_TEXT, jsonContent);
                        startActivity(Intent.createChooser(fallback, safeName));
                    }
                }
            });
            return true;
        }

        @JavascriptInterface
        public boolean shareText(final String title, final String text) {
            if (text == null || text.isEmpty()) return false;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    if (title != null && !title.isEmpty()) {
                        send.putExtra(Intent.EXTRA_SUBJECT, title);
                    }
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    startActivity(Intent.createChooser(send, title != null ? title : "مشاركة"));
                }
            });
            return true;
        }

        @JavascriptInterface
        public boolean printPage(final String jobName) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (webView == null) return;
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (pm == null) return;
                    String name = (jobName != null && !jobName.isEmpty()) ? jobName : "خياطة العمر";
                    PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                    pm.print(name, adapter, new PrintAttributes.Builder().build());
                }
            });
            return true;
        }
    }
}
