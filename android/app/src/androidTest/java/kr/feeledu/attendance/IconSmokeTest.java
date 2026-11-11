package kr.feeledu.attendance;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.DownloadManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.net.Uri;
import android.database.Cursor;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.io.ByteArrayOutputStream;

/** Runs against the installed, signed release APK, including old published APKs. */
public final class IconSmokeTest extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            Context target = getTargetContext();
            Drawable icon = target.getPackageManager().getApplicationIcon("kr.feeledu.attendance");
            Bitmap rendered = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
            icon.setBounds(0, 0, 192, 192);
            icon.draw(new Canvas(rendered));
            int red = 0, black = 0, margin = 192;
            for (int y = 0; y < 192; y++) for (int x = 0; x < 192; x++) {
                int color = rendered.getPixel(x, y);
                if (Color.alpha(color) < 200) continue;
                boolean isRed = Color.red(color) > 150 && Color.green(color) < 100 && Color.blue(color) < 100;
                boolean isBlack = Color.red(color) < 70 && Color.green(color) < 70 && Color.blue(color) < 70;
                if (isRed) red++;
                if (isBlack) black++;
                if (isRed || isBlack) margin = Math.min(margin, Math.min(Math.min(x, y), Math.min(191 - x, 191 - y)));
            }
            File output = new File(target.getExternalFilesDir(null), "launcher-icon-api-" + Build.VERSION.SDK_INT + ".png");
            try (FileOutputStream stream = new FileOutputStream(output)) { rendered.compress(Bitmap.CompressFormat.PNG, 100, stream); }
            if (red < 20 || black < 20 || margin < 5) throw new IllegalStateException("Logo is missing or clipped: red=" + red + ", black=" + black + ", margin=" + margin);
            result.putString("feeledu_status", "PASS");
            result.putString("android_api", String.valueOf(Build.VERSION.SDK_INT));
            result.putString("icon_file", output.getAbsolutePath());
            result.putString("version", target.getPackageManager().getPackageInfo("kr.feeledu.attendance", 0).versionName);
            if (Build.VERSION.SDK_INT >= 29) checkSystemDownload(target, result);
            else result.putString("download_status", "NOT_RUN_API_23");
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            result.putString("feeledu_status", "FAIL");
            result.putString("failure", error.toString());
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void checkSystemDownload(Context context, Bundle result) throws Exception {
        String origin = "https://feeledu-attendance.feeledu-pj-managing.workers.dev";
        HttpURLConnection metadataConnection = (HttpURLConnection) new URL(origin + "/android-release.json").openConnection();
        metadataConnection.setConnectTimeout(20000);
        metadataConnection.setReadTimeout(20000);
        JSONObject metadata;
        try (InputStream input = metadataConnection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            metadata = new JSONObject(output.toString("UTF-8"));
        } finally { metadataConnection.disconnect(); }
        File apk = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "download-self-test.apk");
        if (apk.exists() && !apk.delete()) throw new IllegalStateException("Cannot reset the emulator download fixture");
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        // Verify the primary, immutable GitHub release download. A live server deployment must not
        // change the file between reading release metadata and completing the emulator download.
        String downloadUrl = "https://github.com/dpqksr5501/Feeledu_PJ_Managing/releases/download/android-v"
                + metadata.getString("version") + "/feeledu-attendance.apk";
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(downloadUrl));
        request.setDestinationUri(Uri.fromFile(apk));
        request.setTitle("Feeledu APK download self-test");
        request.setMimeType("application/vnd.android.package-archive");
        long id = manager.enqueue(request), started = System.currentTimeMillis();
        boolean complete = false;
        int status = 0, reason = 0;
        while (System.currentTimeMillis() - started < 90000) {
            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                if (cursor != null && cursor.moveToFirst()) {
                    status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                    if (status == DownloadManager.STATUS_SUCCESSFUL) { complete = true; break; }
                    if (status == DownloadManager.STATUS_FAILED) throw new IllegalStateException("Android download failed: " + reason);
                }
            }
            Thread.sleep(250);
        }
        if (!complete) throw new IllegalStateException("Android download did not complete: status=" + status + ", reason=" + reason);
        result.putString("download_url", downloadUrl);
        result.putLong("download_expected_bytes", metadata.getLong("bytes"));
        result.putLong("download_actual_bytes", apk.length());
        if (apk.length() != metadata.getLong("bytes")) throw new IllegalStateException("Android download size mismatch: expected=" + metadata.getLong("bytes") + ", actual=" + apk.length());
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(apk)) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder hex = new StringBuilder();
        for (byte value : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        if (!hex.toString().equals(metadata.getString("sha256"))) throw new IllegalStateException("Android downloaded APK checksum mismatch");
        result.putString("download_status", "PASS");
        result.putString("download_bytes", String.valueOf(apk.length()));
        result.putString("download_ms", String.valueOf(System.currentTimeMillis() - started));
        apk.delete();
    }
}
