package kr.feeledu.attendance;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import com.google.androidbrowserhelper.trusted.TwaProviderPicker;
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
        clean.setFlags(clean.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
        setIntent(clean);
        super.onCreate(state);
    }

    @Override protected Uri getLaunchingUrl() { return Uri.parse(KIOSK_URL); }
    @Override protected Uri getUrlForIntent(Intent intent) { return null; }

    @Override protected boolean shouldLaunchImmediately() {
        String provider = TwaProviderPicker.pickProvider(getPackageManager()).provider;
        if (provider != null && (provider.equals("com.android.chrome") || provider.startsWith("com.chrome.") || provider.equals("org.chromium.chrome"))) {
            try {
                String version = getPackageManager().getPackageInfo(provider, 0).versionName;
                // The web client uses AbortSignal.timeout (Chrome 103+), alongside modern JS.
                if (version != null && Integer.parseInt(version.split("\\.")[0]) < 103) {
                    startActivity(new Intent(this, BrowserRequiredActivity.class));
                    finish();
                    return false;
                }
            } catch (android.content.pm.PackageManager.NameNotFoundException | NumberFormatException error) {
                android.util.Log.w("FeeleduLauncher", "Cannot inspect browser version", error);
            }
        }
        return true;
    }

    @Override protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        return (context, builder, provider, complete) -> {
            // A plain legacy browser cannot provide the app's Custom Tabs experience.
            String browser = CustomTabsClient.getPackageName(context,
                    provider == null ? null : java.util.Collections.singletonList(provider));
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
