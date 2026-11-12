#!/usr/bin/env node
/**
 * سكريبت بناء ملف APK خفيف ومستقل لتطبيق «خياطة وأقمشة العمر» (com.omr.tailor).
 * يبني واجهة الويب (Vite SingleFile) ثم يحزمها داخل غلاف أندرويد أصلي (WebView + إشعارات + نسخ احتياطي + طباعة).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const WORK_DIR = "/tmp/tailor-apk-build";
const TOOLCHAIN_DIR = "/tmp/android-toolchain";
const OUTPUT_APK = path.join(ROOT, "tailor-orders.apk");
const KEYSTORE_PATH = path.join(TOOLCHAIN_DIR, "tailor-single-device.keystore");

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    ...opts,
  });
}

function ensureToolchain() {
  const javaBin = path.join(TOOLCHAIN_DIR, "py/jdk4py/java-runtime/bin/java");
  const keytoolBin = path.join(TOOLCHAIN_DIR, "py/jdk4py/java-runtime/bin/keytool");
  const aapt2Bin = path.join(TOOLCHAIN_DIR, "npm/node_modules/aaptjs3/bin/x64/linux/aapt2");
  const apksignerJar = path.join(TOOLCHAIN_DIR, "npm/node_modules/@postar/apktool-node/lib/apksigner.jar");
  const androidJar = path.join(TOOLCHAIN_DIR, "jars/android-34.jar");
  const ecjJar = path.join(TOOLCHAIN_DIR, "jars/ecj.jar");
  const d8Jar = path.join(TOOLCHAIN_DIR, "jars/d8.jar");

  for (const required of [javaBin, keytoolBin, aapt2Bin, apksignerJar, androidJar, ecjJar, d8Jar]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Missing Android build tool: ${required}`);
    }
  }
  fs.chmodSync(aapt2Bin, 0o755);
  return { javaBin, keytoolBin, aapt2Bin, apksignerJar, androidJar, ecjJar, d8Jar };
}

/**
 * يكتب ملف ZIP جديد مع ضمان محاذاة 4 بايت (zipalign) لجميع الملفات غير المضغوطة (STORED)
 * مثل resources.arsc والصور، وهو شرط إلزامي في أندرويد 11+ (API 30+).
 */
function createZipAlignedApk(entries, outPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const rawData = entry.data;
    const crc = zlib.crc32(rawData) >>> 0;
    const storeUncompressed = Boolean(entry.store);
    const compressedData = storeUncompressed
      ? rawData
      : zlib.deflateRawSync(rawData, { level: 9 });
    const method = storeUncompressed ? 0 : 8;

    let extraLen = 0;
    if (storeUncompressed) {
      const dataStart = offset + 30 + nameBuf.length;
      const pad = (4 - (dataStart % 4)) % 4;
      extraLen = pad;
    }
    const extraBuf = Buffer.alloc(extraLen, 0);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x0021, 12); // mod date (1980-01-01)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(extraBuf.length, 28);

    const localOffset = offset;
    localParts.push(localHeader, nameBuf, extraBuf, compressedData);
    offset += localHeader.length + nameBuf.length + extraBuf.length + compressedData.length;

    if (storeUncompressed) {
      const actualDataStart = localOffset + 30 + nameBuf.length + extraBuf.length;
      if (actualDataStart % 4 !== 0) {
        throw new Error(`Alignment failed for ${entry.name}: offset ${actualDataStart}`);
      }
    }

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // central extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHeader, nameBuf);
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((s, b) => s + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outPath, Buffer.concat([...localParts, ...centralParts, eocd]));
}

/** يقرأ محتويات ملف ZIP الناتج من aapt2 لإضافة classes.dex وإعادة محاذاته. */
function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid ZIP: EOCD not found");

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let cdPos = buf.readUInt32LE(eocdOffset + 16);
  const out = [];

  for (let idx = 0; idx < totalEntries; idx++) {
    if (buf.readUInt32LE(cdPos) !== 0x02014b50) {
      throw new Error("Invalid central directory header");
    }
    const method = buf.readUInt16LE(cdPos + 10);
    const compSize = buf.readUInt32LE(cdPos + 20);
    const nameLen = buf.readUInt16LE(cdPos + 28);
    const extraLen = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const localOffset = buf.readUInt32LE(cdPos + 42);
    const name = buf.subarray(cdPos + 46, cdPos + 46 + nameLen).toString("utf8");

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compSlice = buf.subarray(dataStart, dataStart + compSize);

    let rawData;
    if (method === 0) {
      rawData = Buffer.from(compSlice);
    } else if (method === 8) {
      rawData = zlib.inflateRawSync(compSlice);
    } else {
      throw new Error(`Unsupported compression method ${method} in ${name}`);
    }

    const shouldStore =
      name === "resources.arsc" ||
      name.endsWith(".png") ||
      name.endsWith(".webp") ||
      name.endsWith(".jpg");

    out.push({ name, data: rawData, store: shouldStore });
    cdPos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function generateIcons(javaBin, ecjJar, srcIconPath, resDir, assetsDir) {
  const iconGenJava = path.join(WORK_DIR, "IconGen.java");
  fs.writeFileSync(
    iconGenJava,
    `
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class IconGen {
    public static void main(String[] args) throws Exception {
        File srcFile = new File(args[0]);
        String resDir = args[1];
        String assetsDir = args[2];
        BufferedImage src = ImageIO.read(srcFile);

        // 1) أيقونات اللانشر القياسية (mipmap)
        int[][] mipmaps = {
            {48, 0}, {72, 1}, {96, 2}, {144, 3}, {192, 4}
        };
        String[] names = {"mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"};
        for (int[] m : mipmaps) {
            File dir = new File(resDir, names[m[1]]);
            dir.mkdirs();
            writeScaled(src, m[0], new File(dir, "ic_launcher.png"));
        }

        // 2) طبقة المقدمة للأيقونة التكيفية (Adaptive Icon Foreground 432x432) باستخلاص المقص الأبيض على خلفية شفافة
        BufferedImage whiteMask = extractWhiteForeground(src);
        BufferedImage adaptiveFg = new BufferedImage(432, 432, BufferedImage.TYPE_INT_ARGB);
        Graphics2D gFg = adaptiveFg.createGraphics();
        gFg.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        gFg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        int inset = 84; // منطقة أمان مثالية داخل 432x432
        gFg.drawImage(whiteMask, inset, inset, 432 - 2 * inset, 432 - 2 * inset, null);
        gFg.dispose();
        File xxhdpi = new File(resDir, "mipmap-xxhdpi");
        xxhdpi.mkdirs();
        ImageIO.write(adaptiveFg, "PNG", new File(xxhdpi, "ic_launcher_foreground.png"));

        // 3) أيقونة شريط الإشعارات الصغيرة (أبيض شفاف 48x48)
        BufferedImage notif = new BufferedImage(48, 48, BufferedImage.TYPE_INT_ARGB);
        Graphics2D gN = notif.createGraphics();
        gN.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        gN.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        gN.drawImage(whiteMask, 4, 4, 40, 40, null);
        gN.dispose();
        File drawDir = new File(resDir, "drawable-xhdpi");
        drawDir.mkdirs();
        ImageIO.write(notif, "PNG", new File(drawDir, "ic_stat_notify.png"));

        // 4) أيقونة الويب داخل الأصول بحجم فعلي 512x512 خفيف
        writeScaled(src, 512, new File(assetsDir, "icon-512.png"));
    }

    private static void writeScaled(BufferedImage src, int size, File out) throws Exception {
        BufferedImage dst = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = dst.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.drawImage(src, 0, 0, size, size, null);
        g.dispose();
        ImageIO.write(dst, "PNG", out);
    }

    private static BufferedImage extractWhiteForeground(BufferedImage src) {
        int w = src.getWidth();
        int h = src.getHeight();
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        int margin = w / 8; // تجاهل الحواف الخارجية البيضاء للمربع المستدير
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if (x < margin || x >= w - margin || y < margin || y >= h - margin) {
                    continue;
                }
                int argb = src.getRGB(x, y);
                int r = (argb >> 16) & 0xFF;
                int g = (argb >> 8) & 0xFF;
                int b = argb & 0xFF;
                int lum = (r + g + b) / 3;
                if (lum > 150) {
                    int alpha = Math.min(255, (lum - 150) * 255 / 105);
                    out.setRGB(x, y, (alpha << 24) | 0x00FFFFFF);
                }
            }
        }
        return out;
    }
}
`,
  );

  run(javaBin, ["-jar", ecjJar, "-11", "-d", WORK_DIR, iconGenJava]);
  run(javaBin, ["-Djava.awt.headless=true", "-cp", WORK_DIR, "IconGen", srcIconPath, resDir, assetsDir]);
}

function collectFiles(dir, suffix = "") {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(full, suffix));
    } else if (!suffix || full.endsWith(suffix)) {
      result.push(full);
    }
  }
  return result;
}

function main() {
  console.log("1/7 Building single-file web bundle (Vite)...");
  run("npm", ["run", "build"], { cwd: ROOT });

  const tools = ensureToolchain();

  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  const resWorkDir = path.join(WORK_DIR, "res");
  const assetsDir = path.join(WORK_DIR, "assets");
  const genJavaDir = path.join(WORK_DIR, "gen");
  const classesDir = path.join(WORK_DIR, "classes");
  const dexDir = path.join(WORK_DIR, "dex");

  for (const d of [resWorkDir, assetsDir, genJavaDir, classesDir, dexDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // نسخ موارد XML الثابتة من android-lite/res
  fs.cpSync(path.join(ROOT, "android-lite/res"), resWorkDir, { recursive: true });

  // نسخ ملفات الويب المبنية إلى assets/
  fs.copyFileSync(path.join(ROOT, "dist/index.html"), path.join(assetsDir, "index.html"));
  fs.copyFileSync(path.join(ROOT, "public/manifest.json"), path.join(assetsDir, "manifest.json"));

  console.log("2/7 Generating Android launcher, adaptive, and notification icons...");
  generateIcons(tools.javaBin, tools.ecjJar, path.join(ROOT, "public/icon-512.png"), resWorkDir, assetsDir);

  console.log("3/7 Compiling Android resources & manifest with aapt2...");
  const compiledResZip = path.join(WORK_DIR, "compiled_res.zip");
  run(tools.aapt2Bin, ["compile", "--dir", resWorkDir, "-o", compiledResZip]);

  const baseApk = path.join(WORK_DIR, "base-resources.apk");
  run(tools.aapt2Bin, [
    "link",
    "-I",
    tools.androidJar,
    "--manifest",
    path.join(ROOT, "android-lite/AndroidManifest.xml"),
    "--java",
    genJavaDir,
    "-A",
    assetsDir,
    "-o",
    baseApk,
    compiledResZip,
  ]);

  console.log("4/7 Compiling Java sources (MainActivity + R) against Android API 34...");
  const javaSources = [
    ...collectFiles(genJavaDir, ".java"),
    ...collectFiles(path.join(ROOT, "android-lite/java"), ".java"),
  ];
  run(tools.javaBin, [
    "-jar",
    tools.ecjJar,
    "-1.8",
    "-encoding",
    "UTF-8",
    "-bootclasspath",
    tools.androidJar,
    "-d",
    classesDir,
    ...javaSources,
  ]);

  console.log("5/7 Compiling JVM bytecode to Dalvik DEX (d8)...");
  const classFiles = collectFiles(classesDir, ".class");
  run(tools.javaBin, [
    "-cp",
    tools.d8Jar,
    "com.android.tools.r8.D8",
    "--release",
    "--min-api",
    "24",
    "--lib",
    tools.androidJar,
    "--output",
    dexDir,
    ...classFiles,
  ]);

  console.log("6/7 Packaging & 4-byte aligning APK...");
  const entries = readZipEntries(baseApk);
  entries.push({
    name: "classes.dex",
    data: fs.readFileSync(path.join(dexDir, "classes.dex")),
    store: false,
  });

  const alignedUnsignedApk = path.join(WORK_DIR, "aligned-unsigned.apk");
  createZipAlignedApk(entries, alignedUnsignedApk);

  console.log("7/7 Signing APK (v1 + v2 + v3) & verifying...");
  if (!fs.existsSync(KEYSTORE_PATH)) {
    run(tools.keytoolBin, [
      "-genkeypair",
      "-keystore",
      KEYSTORE_PATH,
      "-storepass",
      "tailor2026",
      "-keypass",
      "tailor2026",
      "-alias",
      "tailor",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-dname",
      "CN=AlOmr Tailor, OU=Mobile, O=OmrTailor, L=Damascus, C=SY",
    ]);
  }

  run(tools.javaBin, [
    "-jar",
    tools.apksignerJar,
    "sign",
    "--ks",
    KEYSTORE_PATH,
    "--ks-pass",
    "pass:tailor2026",
    "--key-pass",
    "pass:tailor2026",
    "--ks-key-alias",
    "tailor",
    "--v1-signing-enabled",
    "true",
    "--v2-signing-enabled",
    "true",
    "--v3-signing-enabled",
    "true",
    "--v4-signing-enabled",
    "false",
    "--out",
    OUTPUT_APK,
    alignedUnsignedApk,
  ]);

  const verifyOut = run(tools.javaBin, [
    "-jar",
    tools.apksignerJar,
    "verify",
    "--verbose",
    "--min-sdk-version",
    "24",
    OUTPUT_APK,
  ]);
  const badgingOut = run(tools.aapt2Bin, ["dump", "badging", OUTPUT_APK]);

  const sizeKb = (fs.statSync(OUTPUT_APK).size / 1024).toFixed(1);
  console.log("\n=== APK VERIFICATION ===");
  console.log(verifyOut.trim());
  console.log(badgingOut.split("\n").slice(0, 8).join("\n"));
  console.log(`\n✅ Built successfully: ${OUTPUT_APK} (${sizeKb} KB)`);
}

main();
