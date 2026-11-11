package kr.feeledu.attendance;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/** Keep all entry points on our own kiosk origin, using the browser's existing data store. */
public final class MainActivity extends LauncherActivity {
    public static final String KIOSK_URL = "https://feeledu-attendance.feeledu-pj-managing.workers.dev/kiosk";

    @Override protected void onCreate(Bundle state) {
        Intent clean = new Intent(getIntent());
        clean.setDataAndType(null, null);
        clean.replaceExtras((Bundle) null);
        clean.setClipData(null);
        clean.removeFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        setIntent(clean);
        super.onCreate(state);
    }

    @Override protected Uri getLaunchingUrl() { return Uri.parse(KIOSK_URL); }
    @Override protected Uri getUrlForIntent(Intent intent) { return null; }

    @Override protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return (context, builder, provider, complete) -> {
            String browser = provider != null ? provider : CustomTabsClient.getPackageName(context, null);
            if (browser != null) {
                try {
                    CustomTabsIntent tab = builder.buildCustomTabsIntent();
                    tab.intent.setPackage(browser);
                    tab.launchUrl(context, Uri.parse(KIOSK_URL));
                    if (complete != null) complete.run();
                    return;
                } catch (android.content.ActivityNotFoundException | SecurityException error) {
                    android.util.Log.w("FeeleduLauncher", "Browser unavailable", error);
                }
            }
            context.startActivity(new Intent(context, BrowserRequiredActivity.class));
            if (complete != null) complete.run();
        };
    }
}
