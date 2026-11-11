package kr.feeledu.attendance;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import java.io.File;
import java.io.FileOutputStream;

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
            finish(Activity.RESULT_OK, result);
        } catch (Exception error) {
            result.putString("feeledu_status", "FAIL");
            result.putString("failure", error.toString());
            finish(Activity.RESULT_CANCELED, result);
        }
    }
}
